import getpass
import os
from pathlib import Path
import secrets

root = Path(__file__).resolve().parents[1]
destination = root / ".env"
if destination.exists():
    raise SystemExit(".env gia presente: modificarlo direttamente senza sovrascrivere i segreti.")
password = getpass.getpass("Password accesso Studio (almeno 12 caratteri): ")
if len(password) < 12 or "\n" in password or "'" in password:
    raise SystemExit("Usare almeno 12 caratteri, senza apostrofi o ritorni a capo.")
confirmation = getpass.getpass("Conferma password: ")
if password != confirmation:
    raise SystemExit("Le password non coincidono.")
values = {"ADMIN_PASSWORD": f"'{password}'", "SESSION_SECRET": secrets.token_hex(32), "POSTGRES_PASSWORD": secrets.token_hex(24)}
lines = []
for line in (root / ".env.example").read_text().splitlines():
    key = line.split("=", 1)[0]
    lines.append(f"{key}={values[key]}" if key in values else line)
descriptor = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
with os.fdopen(descriptor, "w") as stream:
    stream.write("\n".join(lines) + "\n")
print(".env creato con permessi 600. Configurare endpoint, modelli e accesso HTTPS prima dell'avvio.")