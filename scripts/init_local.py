"""Create ignored local secrets without printing them. Synthetic data only."""

import base64
import os
import secrets
from pathlib import Path

from dotenv import dotenv_values, set_key

root = Path(
    os.environ.get("APP_RUNTIME_DIR", str(Path(__file__).resolve().parents[1] / ".runtime"))
)
root.mkdir(parents=True, exist_ok=True)
for name, value in {
    "django.secret": secrets.token_urlsafe(64),
    "wrapping.key": base64.b64encode(secrets.token_bytes(32)).decode(),
}.items():
    path = root / name
    try:
        with path.open("x", encoding="utf-8") as stream:
            stream.write(value)
        path.chmod(0o600)
    except FileExistsError:
        pass
print("Local synthetic-mode configuration initialized; secrets were not printed.")


config = Path(__file__).resolve().parents[1] / ".env"
if (
    os.environ.get("APP_ENV") != "test"
    and not os.environ.get("DOCUMENT_INTEGRITY_KEY")
    and not dotenv_values(config).get("DOCUMENT_INTEGRITY_KEY")
):
    if not config.exists():
        config.touch(mode=0o600)
    set_key(config, "DOCUMENT_INTEGRITY_KEY", secrets.token_urlsafe(48))
    config.chmod(0o600)
