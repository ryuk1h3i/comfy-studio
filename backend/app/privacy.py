import hashlib
import hmac
import secrets
import time

from fastapi import HTTPException
from sqlalchemy import delete, select, update

from .db import PrivacyDevice, PrivacyUnlock, session

UNLOCK_SECONDS = 60


def identity(value):
    return hashlib.sha256(value["device"].encode()).hexdigest()


def digest(pin, salt):
    return hashlib.scrypt(pin.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()


def status(value):
    with session() as database:
        settings = database.get(PrivacyDevice, identity(value))
        enabled = bool(settings and settings.pin_hash)
        unlock = database.get(PrivacyUnlock, identity(value))
        return {"enabled": enabled, "locked": enabled and not (unlock and unlock.expires > time.time())}


def require_unlocked(value):
    if status(value)["locked"]:
        raise HTTPException(423, "App bloccata. Inserisci il PIN.")


def grant(database, value):
    database.execute(delete(PrivacyUnlock).where(PrivacyUnlock.expires <= time.time()))
    unlock = database.get(PrivacyUnlock, identity(value))
    if not unlock:
        unlock = PrivacyUnlock(id=identity(value))
        database.add(unlock)
    unlock.expires = time.time() + UNLOCK_SECONDS


def lock(value):
    with session() as database:
        database.execute(delete(PrivacyUnlock).where(PrivacyUnlock.id == identity(value)))
    return {"ok": True}


def heartbeat(value):
    with session() as database:
        result = database.execute(update(PrivacyUnlock).where(
            PrivacyUnlock.id == identity(value), PrivacyUnlock.expires > time.time()
        ).values(expires=time.time() + UNLOCK_SECONDS))
        if not result.rowcount:
            raise HTTPException(423, "App bloccata. Inserisci il PIN.")
    return {"ok": True}


def unlock(value, pin):
    error = None
    with session() as database:
        settings = database.scalar(select(PrivacyDevice).where(PrivacyDevice.id == identity(value)).with_for_update())
        if not settings or not settings.pin_hash:
            return {"enabled": False, "locked": False}
        remaining = settings.blocked_until - time.time()
        if remaining > 0:
            error = HTTPException(429, f"Troppi tentativi. Riprova tra {int(remaining) + 1} secondi.")
        elif not hmac.compare_digest(digest(pin, settings.salt), settings.pin_hash):
            settings.failures += 1
            if settings.failures >= 5:
                settings.blocked_until = time.time() + min(3600, 30 * 2 ** min(settings.failures - 5, 7))
            error = HTTPException(400, "PIN non corretto")
        else:
            settings.failures = 0
            settings.blocked_until = 0
            grant(database, value)
    if error:
        raise error
    return {"enabled": True, "locked": False}


def configure(value, pin):
    with session() as database:
        settings = database.scalar(select(PrivacyDevice).where(PrivacyDevice.id == identity(value)).with_for_update())
        if not settings:
            settings = PrivacyDevice(id=identity(value))
            database.add(settings)
        settings.salt = secrets.token_hex(32) if pin else ""
        settings.pin_hash = digest(pin, settings.salt) if pin else ""
        settings.failures = 0
        settings.blocked_until = 0
        database.execute(delete(PrivacyUnlock).where(PrivacyUnlock.id == identity(value)))
        if pin:
            grant(database, value)
    return {"enabled": bool(pin), "locked": False}


def unlock_with_password(value):
    with session() as database:
        grant(database, value)
    return status(value)