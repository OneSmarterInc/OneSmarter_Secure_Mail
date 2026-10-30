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
- `EMAIL_HOST_PASSWORD` is the only SMTP password setting. Supply a newly rotated
  credential in the private root `.env`, or inject it into the process environment.
  It is intentionally blank pending provider-side rotation. No password-file fallback exists.
- `DJANGO_SECRET_KEY` is empty, preserving the existing `.runtime/django.secret`.
  `POSTGRES_PASSWORD` is an empty placeholder for native SQLite development.
- Unseal/recovery/root keys must never be copied into `.env` or `.env.example`.

Legacy SMTP profile loaders are retired. `scripts/with_mail.py` now uses the same
root `.env` and process environment as ordinary Django commands. Setting the retired
`EMAIL_HOST_PASSWORD_FILE` variable causes a clear configuration error rather than
silently reading an old credential. Historical files are not an active configuration source.

## Exposed-credential remediation

P0-1 remains OPEN until the provider password has been rotated and the replacement
verified. Changing configuration storage does not revoke the old password. Rotate
through the email provider, enter the replacement privately in root `.env`, and
verify SMTP authentication without logging credentials. Never send passwords in chat.
Running processes retain their existing configuration until stopped/restarted.
Do not restart the current application onto the new crypto format before its
legacy-envelope migration gate has been addressed. No provider password was rotated,
no email was sent, and no application process was restarted by this configuration change.

For production, inject EMAIL_HOST_PASSWORD from the deployment secret facility;
do not bake .env into images or expose it through VITE_* variables. Restrict local
.env access using OS permissions. Environment variables are configuration delivery,
not encryption or a substitute for secret rotation.

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
