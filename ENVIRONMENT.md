# Local environment configuration

Updated 29 October 2026.

The repository-root `.env` is the local Django API/worker configuration file.
It is ignored by Git and excluded from Docker builds. `.env.example` is the
tracked, shareable template; it contains no credentials. Production remains
blocked by the release gates regardless of values in either file.

For a new checkout, install `requirements.lock`, copy `.env.example` to `.env`,
and run `python scripts/init_local.py` to initialize missing synthetic secret
files. Never replace existing wrapping keys to fix configuration errors.

Django loads only this exact root file, regardless of the current working
directory, using python-dotenv 1.2.4. Existing process environment variables
win, including explicitly empty values. Variable interpolation is disabled so
credential strings containing `${...}` remain literal. Use quoted values for
spaces or `#`. Set `DJANGO_READ_DOT_ENV=false` in the process environment to
ignore the local file for isolated tests or managed deployment. Restart API and
workers after editing; changing a file does not update running process settings.

## Current local profile

- Local URL: `http://localhost:5173`; Vite forwards to the loopback Django API.
- Trusted proxy peer: `127.0.0.1`, for this isolated local machine only.
- SQLite and encrypted documents remain in `.runtime/`; local-development key
  protection remains selected. This does not migrate keys into the key service.
- Real ClamAV endpoint: `127.0.0.1:13310`.
- Key readiness endpoint: `https://localhost:8443` with paths to the existing
  status-only certificate, private key and CA. Unsealing is still separate.
- SMTP remains the previously authorized Private Email profile, port 587 with
  STARTTLS, using `info@kormic.ai`. Running a worker can send queued mail.
- `EMAIL_HOST_PASSWORD` is empty; `EMAIL_HOST_PASSWORD_FILE` points to the existing
  protected `.runtime/smtp.password`. Do not fill both. The SMTP username is
  configuration, not a password.
- `DJANGO_SECRET_KEY` is empty, preserving the existing `.runtime/django.secret`.
  `POSTGRES_PASSWORD` is an empty placeholder for native SQLite development.
- Unseal/recovery/root keys must never be copied into `.env` or `.env.example`.

The old `.runtime/mail.env` is preserved for compatibility with
`scripts/with_mail.py`; that explicit legacy launcher passes process variables
and therefore overrides matching root-file settings. Prefer ordinary Django
commands with the root `.env` as the single local configuration source.
The local restart helper now uses this root file rather than loading mail.env.

## Docker Compose

Compose reads the root file for variable substitution; it does not automatically
forward every key to containers. The explicit `compose.yaml` environment still
controls container settings, including synthetic captured mail. Run
`python scripts/init_compose.py` to fill a missing/blank `POSTGRES_PASSWORD`
without replacing other settings or an existing database credential. Changing
an environment password does not rotate an initialized PostgreSQL account.

Keep backend secrets out of frontend `VITE_*` variables: those can be included
in browser assets. This root file is loaded by Django, not exposed as an asset.


## Explicit operator capabilities and staged storage

SETUP_TOKEN_SHA256 and DEV_INBOX_TOKEN_SHA256 are blank by default in root .env. Configure separate SHA-256 digests of high-entropy random operator tokens; blank disables the corresponding access. Bootstrap consumes its capability when the first staff account is created. The development inbox takes its separate capability through X-Dev-Inbox-Token (the UI has an unlock form); it is never stored in browser persistent storage. See P2_REMEDIATION.md for custody and API details. STAGED_UPLOAD_QUOTA_BYTES defaults to 104857600 for each staff account or recipient grant; committed submissions do not count toward this staged budget.
