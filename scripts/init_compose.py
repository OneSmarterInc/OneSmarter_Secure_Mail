"""Generate missing local Compose credentials without displaying secrets."""

import hashlib
import re
import secrets
import shutil
import subprocess
from pathlib import Path

from dotenv import dotenv_values, set_key


def initialize(path: Path) -> bool:
    existing = dotenv_values(path, interpolate=False) if path.exists() else {}
    token = existing.get("COMPOSE_SETUP_TOKEN")
    digest = existing.get("SETUP_TOKEN_SHA256")
    if digest and not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("SETUP_TOKEN_SHA256 must be a lowercase SHA-256 hex digest")
    if token and not 32 <= len(token) <= 256:
        raise ValueError("COMPOSE_SETUP_TOKEN must contain 32 to 256 characters")
    if token and digest and hashlib.sha256(token.encode()).hexdigest() != digest:
        raise ValueError("COMPOSE_SETUP_TOKEN does not match SETUP_TOKEN_SHA256")
    updates = {}
    if not existing.get("DOCUMENT_INTEGRITY_KEY"):
        updates["DOCUMENT_INTEGRITY_KEY"] = secrets.token_urlsafe(48)
    if not existing.get("POSTGRES_PASSWORD"):
        updates["POSTGRES_PASSWORD"] = secrets.token_urlsafe(48)
    if not digest:
        token = token or secrets.token_urlsafe(48)
        updates["COMPOSE_SETUP_TOKEN"] = token
        updates["SETUP_TOKEN_SHA256"] = hashlib.sha256(token.encode()).hexdigest()
    if not updates:
        return False
    if not path.exists():
        path.touch(mode=0o600, exist_ok=False)
    for name, value in updates.items():
        set_key(path, name, value, quote_mode="always")
    path.chmod(0o600)
    return True


def scanner_group(path: Path):
    if dotenv_values(path, interpolate=False).get("CLAMAV_GID"):
        return
    docker = shutil.which("docker")
    if not docker:
        raise SystemExit(
            "Docker is required to resolve the scanner group. Start Docker and rerun init_compose.py."
        )
    result = subprocess.run(
        [
            docker,
            "run",
            "--rm",
            "--entrypoint",
            "id",
            "clamav/clamav:1.4@sha256:982e28f90061d0e66eb03276419f589a47c9fa601e985e472fc2f6c64b497ca0",
            "-g",
            "clamav",
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=180,
    )
    gid = result.stdout.strip()
    if not re.fullmatch(r"[0-9]+", gid):
        raise ValueError("Scanner image returned an invalid group ID")
    set_key(path, "CLAMAV_GID", gid)


if __name__ == "__main__":
    path = Path(__file__).resolve().parents[1] / ".env"
    changed = initialize(path)
    scanner_group(path)
    print(
        "Created missing Compose credentials in .env. Use COMPOSE_SETUP_TOKEN in the setup form."
        if changed
        else "Existing credentials preserved. Use the saved setup token for first-admin setup."
    )
