# OneSmarter Secure Mail

A working Django/React application for confidential document requests, protected conversations, recipient uploads, and administrator-managed staff access. **Synthetic development use only; production startup is intentionally blocked.**

OSIVault is not a dependency. The project now owns its encryption and key-management code, using Cryptography primitives for AES-256-GCM, real ML-KEM-768, X25519 and HKDF. Read [KEY_MANAGEMENT.md](KEY_MANAGEMENT.md) for key locations, rotation, recovery and the exact limits of the current implementation.

**Self-managed key service update (28 October):** AWS KMS/OSIVault runtime protectors are removed. A separate HTTPS/mTLS service, operator-unseal webpage, scoped identities, version/root rotation, encrypted backup and local-key import are implemented for synthetic use. S3 document/archive adapters use SSE-S3 plus application encryption. Production review, full PQ transport validation, external audit anchoring and operational approval remain open. See [KEY_SERVICE_OPERATIONS.md](KEY_SERVICE_OPERATIONS.md).

Successfully submitted visitor files remain on their original conversation when a session or access link expires. Assigned authorized staff retain read access. There is no automatic age-based deletion of committed submissions; durable storage, backups and recoverable keys are still required. See [DATA_RETENTION.md](DATA_RETENTION.md) for staged-upload exceptions and open retention policies.

## Implemented

- Staff passwords, authenticator MFA, single-use recovery codes, admin-issued account activation/password recovery and session revocation.
- Own-conversation dashboard, secure information requests, normal/protected compose, all-recipient routing and explicit Nophi permission enforcement.
- Fixed-mailbox recipient OTP, scoped sessions, text/files/both replies, private recipient replies, expiry/revocation and authorized downloads.
- Encrypted file/content storage, size/type validation, real ClamAV by default with signature freshness checks and fail-closed upload scanning.
- Durable notification outbox, synthetic mailbox, SMTP adapter, explicit retry with duplicate-risk confirmation and permission/expiry rechecks.
- Access → Accounts: creation, lifecycle actions, permission management, last login/activity, usage, search, filters, sorting and pagination.
- Access → Audit logs: database append-only history, stable snapshots, search/filter/sort, details, expiring permission-checked CSV exports and an S3 Object Lock archive adapter.
- Our own tenant-scoped key versions, rotation, legacy synthetic compatibility and resumable data-key rewrapping without document re-encryption.
- Container definitions, pinned dependencies, CI checks, backend regression tests and a real-browser staff/recipient test.

The backend can decrypt content for authorized users; this is not zero-access E2EE. Administrator account-management authority does not grant another staff member's conversation contents.

## Run locally on Windows

From this repository folder, with Python 3.12 and Node 24:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe scripts/init_local.py
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000 --noreload
```

In a second terminal in the same folder:

```powershell
.\.venv\Scripts\python.exe manage.py runworker
```

In a third terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. Create the first administrator using a fictional `@onesmarter.com` address, set your own password, and enroll an authenticator. There is no default account or shared password. The first administrator can grant privileges and export audit metadata; Nophi is initially off.

Staff use **http://localhost:5173/staff/**; recipients follow their invitation into **http://localhost:5173/recipient/**. The sessions are separate even in the same browser. Staff/admin accounts require @onesmarter.com; recipients may use any valid mailbox. Normal pages do not expose development tools. Local email capture does not send real mail. Operators may explicitly enable `ENABLE_DEV_TOOLS=true` for disposable testing and open `/#/development/inbox`; never enable this on a shared deployment. See [DEPLOYMENT.md](DEPLOYMENT.md) for SMTP, portal URLs and release blockers.

Native development stores data in ignored `.runtime/`. It contains the local database, encrypted objects and private development key files. Preserve it to keep test records readable; deleting/changing the root key without migration loses access. Do not commit or share it. Native Python reads process environment variables, not `.env` automatically.

## Docker Compose

```powershell
python scripts/init_compose.py
docker compose up --build
```

Open **http://localhost:8080**. Compose runs PostgreSQL 17, Redis, migrations, Gunicorn, Celery worker/beat and a built React frontend. Only loopback port 8080 is published. The local frontend shares the API network namespace so its proxy can reach the development-only setup/mailbox on loopback. Do not reuse this preview topology as production infrastructure.

Docker was unavailable on the development host, so the Compose stack is supplied but has not been run here. Its secrets are generated into an ignored `.env`; existing files are preserved. AWS compute, networking, region and managed database/broker choices remain open.

## Verify

```powershell
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
.\.venv\Scripts\python.exe -m ruff check backend scripts
.\.venv\Scripts\python.exe -m ruff format --check backend scripts
.\.venv\Scripts\python.exe -m pytest -q
cd frontend
npm run build
```

If Windows sandbox permissions prevent pytest temporary-directory cleanup, choose a fresh workspace directory with `--basetemp .runtime/pytest-<unique-name>`.

The Playwright flow uses its own database/ports (API 8001, frontend 5174) and private generated test credentials. See [TESTING.md](TESTING.md). Test artifacts can contain synthetic authentication state; `.runtime/` and test outputs are ignored. Do not run browser tests against a real-data workspace.

## Key operations

```powershell
.\.venv\Scripts\python.exe manage.py key_status
.\.venv\Scripts\python.exe manage.py rotate_wrapping_key --organization <UUID> --reason "Scheduled rotation"
.\.venv\Scripts\python.exe manage.py rewrap_keys --organization <UUID> --limit 100
.\.venv\Scripts\python.exe manage.py rewrap_keys --organization <UUID> --limit 100 --apply
```

Rotation preserves old keys for old documents and backups. Rewrapping is optional and resumable. There is no automatic key destruction or unsafe production-enable flag.

## Project guides

- [PRD.md](PRD.md): flows, permissions, requirements and outstanding product decisions.
- [TECH_STACK.md](TECH_STACK.md): architecture and integration boundaries.
- [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md): supplied teal/navy reference, components and accessibility.
- [RULES.md](RULES.md): repository coding/security conventions.
- [ROADMAP.md](ROADMAP.md): observed progress and verification.
- [KEY_MANAGEMENT.md](KEY_MANAGEMENT.md): owned cryptographic implementation and recovery.
- [KEY_SERVICE_ARCHITECTURE.md](KEY_SERVICE_ARCHITECTURE.md): no-AWS-KMS target, root custody, isolation and migration requirements.
- [DATA_RETENTION.md](DATA_RETENTION.md): submitted files versus session/access expiry, retention boundaries and verification.
- [RELEASE_GATES.md](RELEASE_GATES.md): requirements before production or real confidential data.

The original `web/` prototype and seven policy tests are preserved. The live application is `frontend/` plus `backend/`; direct messages composed inside Proton bypass this portal's routing policy.

### Custodian maintenance page

The standalone HTTPS key-custody page provides dedicated sign-in, status, Unseal, Seal and root rotation. Setup, certificate provisioning, explicit local-key import and recovery steps are in [KEY_SERVICE_OPERATIONS.md](KEY_SERVICE_OPERATIONS.md). It is implemented and browser-tested, but not deployed or approved for real documents.

### Operations and integration drills

[OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) documents archive verification/projection recovery, ClamAV setup, PostgreSQL concurrency/restore checks, operational probes, safe staged-upload cleanup, accessibility verification and the saved Private Email SMTP profile. Live-service evidence remains separate from local checks.
