"""Load an ignored SMTP profile and run a chosen Django command. Never print credentials."""

import os
import subprocess
import sys
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    allowed = {
        "MAIL_PROVIDER",
        "EMAIL_HOST",
        "EMAIL_PORT",
        "EMAIL_HOST_USER",
        "EMAIL_HOST_PASSWORD_FILE",
        "DEFAULT_FROM_EMAIL",
    }
    env = dict(os.environ)
    for line in (root / ".runtime/mail.env").read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        key, value = line.split("=", 1)
        if key not in allowed:
            raise ValueError("Unexpected SMTP profile setting")
        env[key] = value
    if len(sys.argv) < 2:
        raise SystemExit("Specify a Django command, for example: check")
    return subprocess.run(
        [sys.executable, str(root / "manage.py"), *sys.argv[1:]], cwd=root, env=env
    ).returncode


if __name__ == "__main__":
    raise SystemExit(main())
