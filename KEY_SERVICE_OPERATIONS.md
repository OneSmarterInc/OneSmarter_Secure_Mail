# Self-managed key service and custodian webpage

Local same-app preview: **http://localhost:5173/maintenance/**. The Vite gateway uses a dedicated PQ/mTLS client identity and preserves a separate custodian password login. See [LOCAL_MAINTENANCE.md](LOCAL_MAINTENANCE.md) for local credentials, restart instructions, and the shared-origin trust boundary. The standalone HTTPS route below remains available. Local HTTP is synthetic-only and does not satisfy the production browser transport requirement.

Updated 2026-10-28. Implemented synthetic candidate, not production approval. No AWS KMS or OSIVault dependency. The normal development application still defaults to its local synthetic protector; selecting the separate service requires the configuration and explicit migration below. Never switch an existing store without inventory and a verified backup.

## What the administrator does

1. An operator provisions a dedicated custodian certificate and account. An ordinary staff administrator does not automatically gain this permission. The same person can hold both roles through separate credentials.
2. Open the dedicated HTTPS maintenance origin with the provisioned browser client certificate. Enter the custodian username and password. Authentication works while document encryption is sealed.
3. The page shows **Sealed**. Retrieve the separately held recovery key, enter it and choose **Unseal key service**.
4. The service verifies audit-chain integrity and authenticates the encrypted root and existing private records before changing to **Ready**. Audit corruption clears live root references and exposes `audit_integrity=failed` through the status API. Incorrect material fails without replacing existing keys. The recovery field is cleared.
5. Authorized workloads can now wrap/unwrap document data keys. Signing out or the five-minute maintenance-session expiry does not seal the service. Choose **Seal key service** to stop new key operations. Already delivered plaintext and in-flight application operations cannot be recalled.
6. A process restart begins sealed and requires another operator unlock. Files remain encrypted and present on disk; they are not deleted by sealing, logout or a visitor session expiry.

The recovery key decrypts a root protection key, which decrypts persistent organization private material. The root remains in the key-service process memory while ready; private material and temporary keys are used in memory during operations. The recovery key is not intentionally saved in browser storage, request logs or the database. Browser/Python memory clearing is not guaranteed. Deployment must protect memory, dumps, swap, tracing and the custodian workstation. A privileged host compromise can extract or misuse live keys.

## Initialization and credentials

Run commands from the repository root using the installed runtime dependencies. Paths below are illustrative Linux deployment paths; provision their ownership and restrictive permissions first. The service is deliberately synthetic-only. Use one service process per SQLite store; multiple processes/replicas and automatic failover are unsupported.

Startup enforces exclusive service ownership using an OS-held `<store>.service.lock` file. Never delete that file to bypass a running owner; stop the owner first. Process termination releases the lock automatically. Use a local filesystem with working OS locks, not a shared network filesystem. A transactional seal epoch additionally invalidates other store objects before their next operation/status check. A failed seal transaction must be treated as an operational failure; already returned DEKs/plaintext cannot be recalled.

```bash
python -m backend.keyservice init --store /srv/onesmarter-keys/store.sqlite3
python -m backend.keyservice identity --policy /srv/onesmarter-keys/policy.json --cert /pki/custodian.pem --name custodian --role custodian
python -m backend.keyservice identity --policy /srv/onesmarter-keys/policy.json --cert /pki/workload.pem --name document-worker --role workload --organization ORGANIZATION_UUID
python -m backend.keyservice identity --policy /srv/onesmarter-keys/policy.json --cert /pki/maintenance.pem --name key-maintenance --role maintenance --organization ORGANIZATION_UUID
python -m backend.keyservice serve --store /srv/onesmarter-keys/store.sqlite3 --backup-directory /mounted-independent-backups/onesmarter --policy /srv/onesmarter-keys/policy.json --cert /pki/server.pem --key /pki/server.key --ca /pki/client-ca.pem --origin https://keys.example.test:8443 --host 127.0.0.1 --port 8443 --synthetic-only
```

Replace the organization placeholder with its actual UUID. Certificates must be issued through an approved PKI: server SAN must match the HTTPS hostname, server/client EKUs must be appropriate, and clients require a trusted issuing CA. The custodian browser needs its own certificate/private-key credential provisioned through the operating system/browser certificate facility. The application gets a different workload certificate. This runbook does not provision a public hostname, trusted PKI or install browser credentials. Bind/network exposure must match the deployment design; do not bypass mTLS at a reverse proxy.

Initialization generates a random recovery secret and writes it without printing it; move it into separately controlled custody and verify recovery before deleting any staging copy. Windows requires explicit ACL management; POSIX chmod is not a substitute. Never put recovery material in `.env`, command-line arguments, container images, source control or application secrets configuration. Custodian registration prompts for a password and stores only its Argon2 hash. Certificates are allowlisted by SHA-256 fingerprint with expiry and exact organization scopes. Policy changes are reread on each request; changes invalidate existing maintenance sessions. Protect and back up policy and PKI separately. Do not perform concurrent policy-file writes.

## Application integration and existing records

Nonsecret settings: `KEY_PROTECTOR=key-service`, `KEY_SERVICE_URL`, `KEY_SERVICE_CA`, `KEY_SERVICE_CERT`, `KEY_SERVICE_KEY`. The last three are filesystem paths; protect private-key files. No recovery/root secret belongs in these settings. The HTTPS client requires TLS 1.3, validates server certificates, uses client authentication, has bounded responses/timeouts and never falls back to local protection after service failure.

For the strict transport profile also set `PQ_TRANSPORT_REQUIRED=true` and use Python 3.15+ with hybrid-capable OpenSSL. The client requires and checks `X25519MLKEM768` before sending key material. The `serve` CLI now defaults to PQ-only transport, including custodian browser connections. Existing classical synthetic previews must explicitly pass `--allow-classical-synthetic`; never use that flag in the strict profile. See [PQ_TRANSPORT.md](PQ_TRANSPORT.md) for runtime, scanner, edge and recovery requirements.

For existing local synthetic versions, first run `python manage.py import_local_keys --organization ORGANIZATION_UUID` for validation, then `python manage.py import_local_keys --organization ORGANIZATION_UUID --apply` with a narrowly scoped maintenance certificate configured. Imports are explicit, idempotent and decrypt-only. Originals are preserved. Use the existing `rotate_wrapping_key` command with maintenance credentials to create an active service version, then configure workload credentials for the running application. Inspect the command's `--help` for organization selection. Verify every old and new document before retiring the local protector; preserve old backups with their matching keys. Never send private import material through the browser.

Before that import, any v1 envelopes must be converted in an isolated offline maintenance run with the application stopped, `KEY_PROTECTOR=local-development` and `ALLOW_LEGACY_SYNTHETIC_READS=true`. Run `python manage.py rewrap_keys --organization ORGANIZATION_UUID` to inspect candidates, then add `--apply` and repeat until no candidates remain. This converts v1 to local v2; import those v2 private versions next using the steps above. Service mode rejects v1 even when the legacy flag is true. Do not temporarily re-enable a local protector in a serving application to bypass a sealed service, and do not delete keys required by old backups.

The Django mirror stores public metadata and service references, not service private keys. Runtime unwrap returns a temporary document DEK to the authorized application, which decrypts the requested content. Compromising that application can misuse its scoped unwrap authority. The service cannot independently establish end-user permission; Django must enforce document ownership/access on every operation. Service-native rewrap keeps the DEK inside the service. The existing application migration path also reads the DEK to authenticate content before replacing its wrapper.

## Internal HTTP contract

Every request uses mTLS. JSON POST requests have exact fields and a 16 KiB limit. There is no root/private-key export endpoint. Operations enforce both policy allowlists and role constraints. Workload requests do not use browser session cookies.

| Route | Fields | Authority/result |
| --- | --- | --- |
| `/login` | username, password | Custodian certificate, exact Origin; HttpOnly/Secure/SameSite session and CSRF token |
| `/v1/custody-status` | none | Custodian session/CSRF/Origin; sealed state and root identifier |
| `/v1/unseal` | secret | Custodian session; canonical Base64 random 32-byte secret |
| `/v1/seal` | none | Custodian session; clears live root references |
| `/v1/rotate-root` | secret, expected | Custodian session; new recovery secret and expected root UUID |
| `/v1/logout` | none | Custodian session; revoke login, keep sealing state |
| `/v1/status` | none | Authorized service identity; safe status/checkpoint |
| `/v1/versions` | organization; optional active (boolean), after (canonical UUID) | Scoped public metadata, at most 100 entries; returns versions and next_cursor. active=true returns only the active key and cannot be combined with a nonempty cursor |
| `/v1/rotate` | organization, expected, request_id | Maintenance; active-version compare-and-swap, UUID idempotency key |
| `/v1/import` | organization, key_id, private | Maintenance; explicit legacy private-material import, never export |
| `/v1/wrap` | organization, context, dek, expected | Workload; exact active version and context-bound wrapper |
| `/v1/unwrap` | organization, context, wrapper | Workload; temporary Base64 DEK |
| `/v1/rewrap` | organization, context, wrapper, expected | Workload; new wrapper, same DEK |

Django uses `active=true` so active-key resolution is independent of retained history. Historical clients must follow `next_cursor` using `after` until it is null; an exactly full last page may require one final empty request. Existing requests without optional fields return the first page. Deploy the service update before the Django update: old servers reject the new field rather than silently falling back. Cursor pagination is not a snapshot during concurrent rotation.

Audit verification detects inconsistent hashes, links and sequence gaps at unseal. It cannot detect a fully rewritten chain or rollback to a valid older store without an independently protected checkpoint. Preserve external checkpoint/restore controls as release gates; do not repair a failed audit by rewriting history. Investigate and recover from verified backups. `verified_at_unseal` means verification at that point, not continuous integrity attestation.

400 rejects malformed/unsupported material, 403 denies identity/scope/session/rate-limit failures, 409 indicates a state conflict, and 503 indicates sealed/unavailable service. Root mutations are limited to five attempts per minute per certificate; login has its own five-per-minute limit. TLS connections and request execution are bounded. TLS 1.3 alone does not establish post-quantum transport: actual negotiated algorithms on every required path remain a release gate.

## Rotation and recovery

Organization-version rotation retains old versions as decrypt-only; old documents remain readable. Rewrapping changes the DEK wrapper and preserves content ciphertext. Root rotation generates a new root, re-protects all private versions and updates the encrypted root header in one transaction, then changes memory state. Interrupted transactions roll back. It serializes operations and requires sizing/latency tests before production. The new recovery input must be generated using a cryptographically secure generator, not a password; length validation cannot establish entropy.

Before root rotation, take a verified encrypted backup with `python -m backend.keyservice backup --store STORE_PATH --destination NEW_BACKUP_PATH`. Keep the matching old recovery material separately. Save the new recovery material separately before submitting the rotation form. An old backup still needs the old secret. If the response is lost, inspect the root identifier and perform an isolated restore/unseal check; do not blindly repeat rotation or destroy either secret.

Restore a copied encrypted backup into an isolated service, use its matching recovery secret, verify key inventory and representative retained documents, and validate application/object metadata consistency before cutover. SQLite backup covers the key store only: object versions, PostgreSQL, policy, certificates, formats/dependencies and custody material need coordinated recovery planning. Losing every usable key/recovery copy makes retained ciphertext unreadable.

## Evidence and remaining release gates

`backend/tests/test_keyservice.py` tests real local HTTPS/mTLS, role/scope rejection, wrong secrets, sealed restart, concurrent reads/rotation, idempotency, rollback, encrypted backup restoration and Django migration without persistent private-key export. `test_crypto_vectors.py` uses a pinned public ML-KEM KAT, RFC X25519/HKDF vectors and AES-GCM known answers, plus two-direction comparison with separate primitive implementations. Test-only kyber-py must never enter runtime code. These tests do not constitute independent protocol review.

The optional browser check uses headless Edge and temporary synthetic certificates: install frontend dependencies, set `RUN_KEY_PORTAL_BROWSER=1`, and run `pytest backend/tests/test_keyservice.py::test_custodian_browser`. It verifies login/unseal/cleared input/seal/logout and creates `.runtime/key-custody.png`. Its certificate-validation bypass is confined to the synthetic browser test.

The local audit chain and SQL triggers are tamper-evident relative to a retained trusted checkpoint, not immutable against host/database owners. External anchoring, audit verification/export, storage-failure alerting and production retention remain outstanding. Also required: independent exact-profile/dependency review, verified PQ transport, production PKI/custodian approval, OS memory hardening, PostgreSQL/deployment fault drills, capacity/availability validation and approved region/retention policy. No production gate is removed by this implementation.

## Rotation backup and off-host custody update (29 October 2026)

Initialization now prompts for a random 32-byte base64 secret generated and kept
in separate off-host custody. It does not write that secret to the key host.
A filesystem path outside the store directory is not proof of separate-host custody.
The old recovery-file mode and localhost bootstrap script require the explicit
`--allow-local-recovery-synthetic` option; never use that exception for real data.
Existing local demo custody artifacts have not been moved or deleted by this change.

Serve requires `--backup-directory`. Provision a separately protected off-host
mounted destination and exercise actual outage/recovery before deployment. Local
synthetic tests use a same-host directory and do not prove disaster durability.
Before activating a rotated/imported key or committing root rotation, the store
creates and fsyncs a complete encrypted-key snapshot from the pending transaction.
Backup failure aborts activation. A crash after snapshot but before commit can
leave an extra unused snapshot; reconcile with the protected audit checkpoint,
not just filename timestamps. No automatic snapshot expiry is introduced.

Restore to a new path only:

```sh
python -m backend.keyservice restore --backup /backup/snapshot.sqlite3 --destination /recovery/new-store.sqlite3
```

The CLI prompts for the matching off-host secret, checks SQLite integrity, audit
consistency and every encrypted private record, then publishes a sealed store.
It refuses an existing destination. Root-rotation backups need the corresponding
new secret; retain old custody for retained older backups. A successful local
restore is not proof that the backup mount is off-host or that the snapshot is
fresh. External checkpoints and coordinated application/key restoration remain gates.

Custody roadmap: select an independently reviewed threshold-sharing or HSM-backed
root-unseal design; require M-of-N separate custodians/devices, scoped identities,
quorum approval/audit, lost-share and compromise recovery, and drills before real
PHI use. Do not implement ad-hoc Shamir mathematics or claim that a single secret
and password constitute a quorum. Budget, exact threshold, hardware/provider and
operator approval remain unresolved.


## P3 hardening update

See [P3_REMEDIATION.md](P3_REMEDIATION.md) for stable rotation IDs/expected versions, recipient URL cleanup, bounded encrypted-subject search, and deployment verification limits. Rotation retries must reuse the original operation parameters.
