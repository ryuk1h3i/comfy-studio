from collections import defaultdict, deque
import hashlib
import hmac
import secrets
import time

from fastapi import HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .config import ADMIN_PASSWORD, SESSION_SECRET

signer = URLSafeTimedSerializer(SESSION_SECRET, salt="studio-session-v1")
password_salt = hashlib.sha256(SESSION_SECRET.encode()).digest()
password_hash = hashlib.scrypt(ADMIN_PASSWORD.encode(), salt=password_salt, n=16384, r=8, p=1)
attempts = defaultdict(deque)


def login(request, password):
    address = request.client.host if request.client else "local"
    history = attempts[address]
    while history and time.monotonic() - history[0] > 300:
        history.popleft()
    if len(history) >= 8:
        raise HTTPException(429, "Troppi tentativi. Attendi cinque minuti.")
    history.append(time.monotonic())
    candidate = hashlib.scrypt(password.encode(), salt=password_salt, n=16384, r=8, p=1)
    if not hmac.compare_digest(candidate, password_hash):
        raise HTTPException(401, "Password non corretta")
    history.clear()
    return {"csrf": secrets.token_hex(24)}


def authenticated(request: Request):
    try:
        value = signer.loads(request.cookies.get("studio", ""), max_age=60 * 60 * 24 * 7)
    except (BadSignature, SignatureExpired):
        raise HTTPException(401, "Accedi per continuare") from None
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        if not hmac.compare_digest(request.headers.get("x-csrf-token", ""), value["csrf"]):
            raise HTTPException(403, "Sessione non valida: ricarica la pagina")
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
            raise HTTPException(403, "Origine non consentita")
    return value