"""Generate a local Compose database credential once, without displaying it."""

import secrets
from pathlib import Path

path = Path(__file__).resolve().parents[1] / ".env"
try:
    with path.open("x", encoding="utf-8") as stream:
        stream.write("POSTGRES_PASSWORD=" + secrets.token_urlsafe(48) + "\n")
    path.chmod(0o600)
    print("Created private local Compose configuration.")
except FileExistsError:
    print("Existing .env preserved. Confirm POSTGRES_PASSWORD is set before starting Compose.")
