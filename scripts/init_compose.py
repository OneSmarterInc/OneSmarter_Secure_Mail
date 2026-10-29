"""Generate the missing local Compose database credential without displaying it."""

import secrets
from pathlib import Path

from dotenv import dotenv_values, set_key


def initialize(path: Path) -> bool:
    existing = dotenv_values(path, interpolate=False) if path.exists() else {}
    if existing.get("POSTGRES_PASSWORD"):
        return False
    if not path.exists():
        path.touch(mode=0o600, exist_ok=False)
    set_key(path, "POSTGRES_PASSWORD", secrets.token_urlsafe(48), quote_mode="always")
    path.chmod(0o600)
    return True


if __name__ == "__main__":
    changed = initialize(Path(__file__).resolve().parents[1] / ".env")
    print(
        "Created private Compose database credential."
        if changed
        else "Existing credential preserved."
    )
