"""Create ignored local secrets without printing them. Synthetic data only."""

import base64
import os
import secrets
from pathlib import Path

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
