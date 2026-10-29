# Production release gates

Updated 2026-10-28. This repository provides a functioning synthetic development application. It must not handle real confidential documents yet. `APP_ENV` values other than `development` and `test` deliberately fail startup. Do not remove that gate simply to deploy.

Internal review on 2026-10-28 reproduced four code defects, subsequently repaired: legacy local-key reads in service mode, sealing limited to one store instance, unbounded version-history responses, and missing audit-chain verification on unseal. See [ENCRYPTION_REVIEW.md](ENCRYPTION_REVIEW.md) for repairs and regression evidence. Independent cryptographic review, external audit checkpoints/rollback detection, approved PQ transport and deployment evidence remain required; passing tests are not release approval.

| Gate | Required evidence | Current position |
| --- | --- | --- |
| OneSmarter-owned cryptographic system | Independent review of the exact hybrid profile, hierarchy, dependency provenance, known-answer vectors and independent interoperability; safe algorithm rejection and migration | Local candidate implemented; not independently reviewed and not X-Wing/HPKE by naming its primitives |
| Self-managed key service and custody | No AWS KMS/OSIVault dependency; isolated service, scoped identities, sealed startup, approved operator/hardware custody, root rotation, actual recovery and no runtime private-key export | Synthetic service and operator-unseal webpage implemented; production custody approval, hardening and independent review pending |
| Mandatory genuine PQ scope | Verified stored protection and every required plaintext/key-bearing browser, ingress, key-service, scanning and recovery hop; explicit authentication/email scope; downgrade rejection | PQ-only TLS adapter, key-service enforcement, scanner gateway, backup-transfer adapter and HTTPS-edge candidate supplied. Real local hybrid/downgrade, browser and adapter checks pass; actual ingress/ClamAV/backup deployment and full-scope approval pending. See PQ_TRANSPORT.md |
| Region and retention | Approved region, exceptional disposal/legal hold and audit/backup/export periods; prove committed submissions survive session/access expiry and remain on the same thread | Documents retained on persistent storage attached to the AWS app instance; no automatic age-based deletion. Region, detailed policies, off-instance backups and recovery targets still open |
| Deployment without AWS KMS | Selected compute/network/identity, private storage without SSE-KMS dependency, PostgreSQL/Redis, protected transport and monitoring; verify storage/archive/backup integrations | Local definitions supplied; runtime KMS protector/settings removed; S3 adapters use SSE-S3; no live deployment evidence |
| Immutable archive | Object Lock COMPLIANCE version retention, denied mutation/delete tests, root-key protection, gap/outage alerting and projection rebuild drill | Append-only triggers, exact-version readback/digest checks, failure tests and independent projection rebuild tested; opt-in AWS denial drill supplied but not run; live retention, external checkpoint and alerts pending |
| Real email | Approved SMTP provider credentials/senders, TLS, delivery/bounce handling, throttling, notification redaction, uncertainty/retry evidence | Private Email SMTP authentication and one explicitly authorized notification reached provider_accepted on 2026-10-28; inbox receipt, bounce handling and deployed public-link verification remain pending |
| Upload scanning | Deployed ClamAV signatures, quarantine/outage/malicious-file tests, handling limits and service isolation | Real WSL ClamAV clean/EICAR/API/outage/stream-cap checks passed; signature-age/deadline tests pass; default Unix-socket Compose and CI supplied. Container deployment, load/alerting and nested/encrypted-content corpus remain pending; archive limitation documented in runbook |
| Database concurrency | PostgreSQL OTP/idempotency/last-admin races, deadlock/retry behavior and resource revocation races | Real PostgreSQL 17 tests pass for OTP, idempotency, last-admin, reply/revocation races and lock-timeout rollback/retry; forced deadlock rollback/retry also passed; load and broader deployment races pending |
| Operations | Actual root/key-store/data restore and rollback, alert owners, RTO/RPO, unlock/restart availability, rate-limit capacity, safe staged cleanup and growing retained-storage monitoring | Actual isolated pg_dump/pg_restore, encrypted object and key-store recovery tested separately; operational probe and guarded staged cleanup implemented; coordinated production restore, on-call/RTO/RPO/backup policies pending |
| Accessibility and browser assurance | Keyboard/screen-reader and responsive coverage with no blocked critical flows | Staff/recipient workflow with axe checks on document, recipient, accounts/dialog, audit and mobile passes; avatar contrast and Escape focus-return fixed; manual screen-reader/cross-browser audit pending |

The application service is trusted with plaintext and temporary keys. A portal administrator has account/audit authority but no automatic access to another staff member's documents. Infrastructure/key custodians are a separate trust boundary.

The archive database role must be separated from migration/table-owner roles. Triggers protect normal writes; an owner can remove them. Until storage archival is verified, keep **Pending archive** visible. Object Lock does not protect against lost/deleted application root keys, private material or custody recovery authority. Preserve exact object versions and independently protected archive evidence.

The user requires our own system and excludes AWS KMS. This decision does not certify the current candidate or permit a production local root file. See [KEY_SERVICE_ARCHITECTURE.md](KEY_SERVICE_ARCHITECTURE.md) for the implementation/removal sequence and [DATA_RETENTION.md](DATA_RETENTION.md) for retention boundaries. Never delete the only old protector before dependent records/backups are safely migrated.

## Required release evidence bundle

- Protocol specification/version and independent design/implementation findings with required remediation complete.
- Reproducible independent vectors/interoperability, malformed-suite and cross-scope rejection evidence.
- Real PostgreSQL concurrent rotation/read/write tests and interrupted object/database migrations.
- Selected root-custody initialization, sealed restart, recovery and root-rotation drills using actual custodians/hardware, not mocks.
- Proof of no AWS KMS dependency, including S3 document/archive calls, infrastructure and backups; no silent fallback.
- Same-thread retained-file reads after recipient timeout/logout/expiry/revocation; safe orphan cleanup; key/backups available for the retention horizon.
- Verified required PQ transport, protected auditing, operational alerts and approved region/policy/availability decisions.
