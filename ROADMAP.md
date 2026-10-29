# OneSmarter Secure Mail â€” Progress and Roadmap

Updated: 2026-10-28. This records observed implementation and remaining work; it is not production approval.

## Current position

The repository now contains a functioning Django/React application, not just the original static prototype. The staff-to-recipient document flow, MFA, administrator accounts, searchable audit history and OneSmarter-owned cryptographic system are implemented and locally exercised. Real confidential data remains prohibited until the release gates are satisfied.

The user replaced the proposed OSIVault dependency with our own system on 28 October. The application has no OSIVault runtime requirement. We own envelope formats and key lifecycle while using established Cryptography/OpenSSL primitives. See [KEY_MANAGEMENT.md](KEY_MANAGEMENT.md).

**Self-managed key service update (28 October):** AWS KMS/OSIVault runtime protectors are removed. A separate HTTPS/mTLS service, operator-unseal webpage, scoped identities, version/root rotation, encrypted backup and local-key import are implemented for synthetic use. S3 document/archive adapters use SSE-S3 plus application encryption. Production review, full PQ transport validation, external audit anchoring and operational approval remain open. See [KEY_SERVICE_OPERATIONS.md](KEY_SERVICE_OPERATIONS.md).

## Implemented and checked locally

| Area | Delivered behavior | Evidence / limitation |
| --- | --- | --- |
| Backend and frontend | Django 5.2/DRF; React 19/strict TypeScript/Vite; pinned lockfiles | Django checks, migrations, Ruff and frontend build/format checks |
| Staff authentication | Passwords, TOTP MFA, enrollment QR, single-use recovery codes, post-MFA last login, recent-MFA recheck | Backend tests and actual browser enrollment/login |
| Staff management | Admin-created accounts, invitation activation, roles/permissions, suspend/reactivate/deactivate, recovery and session revocation | API tests; account creation/search/sort exercised in browser |
| Last administrator safety | Last active administrator and last privilege manager protected | Transactional checks and regression tests; PostgreSQL concurrent races still require validation |
| Routing | Exact internal domain, To/Cc/Bcc, protected requests/threads, explicit Nophi permission | Original seven policy tests plus API tests |
| Protected conversations | Optional instructions, encrypted content, private recipient replies, expiry/revocation, own-conversation scope | API tests and browser request/reply flow |
| Recipient access | Fixed destination, masked mailbox, opaque tokens, throttled single-use codes, scoped sessions | Positive/negative tests; separate browser context verified |
| Documents | Actual uploaded bytes, encrypted private storage, authenticated downloads, type/size limits | Browser download compared byte for byte with original; crypto/context tampering tests |
| OneSmarter encryption | Real ML-KEM-768 + X25519 hybrid DEK wrapping; AES-256-GCM content; tenant key versions | Algorithm roundtrip/tampering/downgrade/isolation tests; independent protocol review pending |
| Rotation and recovery | Old versions retained; bounded rewrap; old documents remain readable without content re-encryption | Record/file migration, ciphertext preservation, failed-rotation and root-loss/recovery tests |
| Self-managed key custody | Separate HTTPS service and custodian webpage; restart sealed; no runtime private-key export | Local HTTPS, encrypted restore, concurrent rotation/read and browser flow tested; production approval pending |
| Delivery | Durable encrypted outbox, local capture, SMTP adapter, explicit retry, stale-code/invitation and permission checks | Local worker/browser tests; real Proton integration unconfigured |
| Audit | Append-only database triggers, immutable event API, stable signed snapshots, filters/sorts/details, expiring CSV export authorization | Mutation-denial, stable snapshot and formula-escaping tests; browser audit search/details |
| Archive | S3 COMPLIANCE Object Lock writer with version/retention confirmation | Adapter implemented; live enforcement, verification/rebuild drill still required |
| Interface | Teal/navy reference, responsive staff/recipient views, accessible forms/dialogs, mobile sign-out | Desktop/mobile screenshots inspected; browser reflow/error check |
| Infrastructure | Local PostgreSQL/Redis/API/worker/beat/frontend Compose; GitHub Actions checks | Supplied; Docker absent locally and remote CI not run in this session |

## Verification record

- Backend suite: **52 tests passed** on 2026-10-28, including retained-document access after recipient revocation.
- Real-browser integration: one full scenario passed with the OneSmarter hybrid encryption module, covering request, OTP, upload/reply, exact-byte download, account creation, audit search/details and mobile reflow.
- Frontend: strict TypeScript/Vite production build passed; Prettier checks passed; npm dependency install audit reported zero vulnerabilities.
- Local API/database tests used SQLite, not PostgreSQL. KMS used a test double. Delivery used local capture. These results do not imply external integration certification.
- Browser screenshots and private test fixture state are in ignored `.runtime/browser-artifacts/`. The normal `.runtime/dev.sqlite3` workspace remains separate from the browser-test database.
- Documentation reconciliation on 2026-10-28: all 12 top-level Markdown files passed local-link, code-fence and encoding checks; `git diff --check` passed. The existing retained-file-after-recipient-revocation regression was rerun in an isolated temporary test directory: **1 passed**. This is not a new full-suite run or evidence that session/access-expiry and recovery cases all pass.

## Remaining production gates

1. Independent review of our exact hybrid protocol, key custody, legacy migration and dependency provenance; independent test vectors and complete PQ path coverage.
2. Approve region, exceptional disposal/legal hold, audit/export/backup policies and availability targets. Committed submissions have no automatic timed deletion; prove retention independently of sessions/access expiry.
3. Independently review and harden the implemented isolated service and operator-unseal custody. Validate explicit migration and deployed SSE-S3 policies. Provision private storage/compute/network identities and perform actual root/key-store/data recovery drills without AWS KMS.
4. PostgreSQL concurrency tests for duplicate requests, code consumption, account/permission races, audit sequencing and worker contention; remote CI execution.
5. Live Proton SMTP transport verification, sender configuration, monitoring/bounce handling and delivery uncertainty tests.
6. Real ClamAV deployment/signature maintenance, isolation, quarantine/outage tests, cleanup/reconciliation and safe upload lifecycle review.
7. S3 immutable-version denial tests, protected pending-journal/outage policy, archive-gap detection and projection rebuild verification.
8. Independent security and accessibility review, deployment/restore/rollback drills and operational ownership.

The detailed acceptance criteria remain in [PRD.md](PRD.md), [TECH_STACK.md](TECH_STACK.md), and [RELEASE_GATES.md](RELEASE_GATES.md). Shared conversation ownership/reassignment, exceptional administrative document access, account date-range filters, audit new-event indicators and asynchronous large exports are not represented as implemented features.

## Next encryption delivery sequence

1. Decide operator-unlock versus hardware custody and recovery/availability policy; freeze the exact hybrid profile and internal operation schemas with independent review.
2. Build isolated scoped wrapping service, sealed-state behavior and separately protected audit records; integrate without returning persistent private keys to Django.
3. Inventory and migrate legacy-protected records; replace KMS root/storage/archive paths and configuration; retain only explicitly supported version compatibility.
4. Add independent vectors/interoperability, sealed/unavailable service, authorization, concurrent migration/rotation, actual recovery and verified transport tests.
5. Validate retained-file lifetime independently of session/grant expiration and cleanup, then complete deployment/review gates. No production enablement is implied by documentation updates.

## Session history

| Date | Change | Evidence |
| --- | --- | --- |
| 2026-10-27 | Created project guidance from the supplied requirements/HTML and recorded user decisions | PRD, stack, design, coding rules and initial roadmap |
| 2026-10-27 | Added administrator-managed accounts and immutable audit requirements | Access workspace and lifecycle/usage/table/archive contracts |
| 2026-10-27â€“28 | Built the Django/React application, local workers, tests and container/CI definitions | Running local services and end-to-end browser flow |
| 2026-10-28 | Replaced the proposed OSIVault dependency with OneSmarter-owned encryption and key lifecycle | Real ML-KEM hybrid envelopes, rotation, resumable migration, recovery/tamper tests and updated guides |
| 2026-10-28 | Superseded AWS KMS with a self-managed key-service target; documented AES/hybrid/PQ requirements and persistent same-thread visitor submissions | Documentation and code-path inspection only; runtime adapters unchanged; new key service/custody and expanded tests pending |

No production release, external deployment, Git commit, push or pull request has been made during this implementation.

## Key-service delivery verification — 28 October 2026

Follow-up: consolidated local/service hybrid encryption into a shared protocol without changing valid v2 envelopes. Added strict JSON/version rejection, fresh-material checks and Django sealed-service read/write/rewrap denial with recovery. Required PQ network coverage and independent protocol approval remain separate release gates.

73 backend/policy tests passed; the opt-in custodian browser test passed separately. Ruff and Django/migration checks passed. Delivered independent maintenance sign-in, Unseal/Seal, root rotation, scoped mTLS runtime APIs, explicit local import and encrypted backup recovery. No live deployment, production custody ceremony, independent protocol review or full PQ transport validation is claimed.

## Application-instance document storage - 28 October 2026

User selected persistent storage on the AWS application instance for uploads, superseding primary S3 attachment storage. Updated PRD, stack, retention and release gates. Dedicated EBS data volume is the proposed implementation; region, backup destination and no-KMS-compatible volume encryption remain open. No deployment changes made. Audit archival and custody isolation remain separate requirements.

## Audit, scanning, operations and accessibility follow-up

Added archive exact-version readback verification, a protected-manifest workflow and independent recovery projection, strict ClamAV response handling and outage/rejection tests, a real-scanner Compose/CI configuration, operational probes and dry-run-first staged cleanup. Seven isolated PostgreSQL 17 tests passed, including concurrency and a real dump/restore drill. Browser flow with axe and keyboard checks passed after fixing avatar contrast and modal focus return. Full production AWS/ClamAV deployment, independent audit checkpoints, actual alert routing and manual accessibility review remain pending. Private Email supersedes Proton for the saved local SMTP profile; no live message was sent. See OPERATIONS_RUNBOOK.md.

## ClamAV implementation - 2026-10-28

Real scanning now defaults on, with a Compose Unix socket, persistent official signature updates, signature-age enforcement and an operator health command. Full regression with live scanner: 122 passed, 9 skipped. Real clean/EICAR API, outage and stream-limit checks passed on WSL ClamAV 1.5.4. Container rollout, image pinning, operator alerts, memory/load tests and nested/encrypted document corpus remain open. See the runbook for the observed archive limitation.

## Portal separation and deployment interface - 2026-10-28

Staff and administrators require exact @onesmarter.com accounts. Recipients may use any valid mailbox. Staff enter through /staff/; invitation links enter through /recipient/ and use a separate API namespace and session cookie. Normal user pages no longer display development banners, test-mailbox controls or engineering release requirements. Operator test tools require explicit opt-in. Local captured notifications are explicitly marked not emailed. This supersedes earlier instructions to show development-mode banners on customer pages; deployment status remains documented and enforced on the server. See [DEPLOYMENT.md](DEPLOYMENT.md) for compatibility, configuration and outstanding release blockers.

Portal-boundary verification (2026-10-28): full regression run 125 passed, 12 opt-in tests skipped; final focused boundary tests 7 passed after disabling legacy recipient endpoints by default. Actual browser staff request/recipient upload/staff read/admin audit workflow passed with accessibility checks. TypeScript/build, formatting, Ruff and Django checks passed. Local API was restarted; recipient entry point responds and test-mailbox/legacy recipient endpoints return 404. No public production deployment or real email was verified.

## Connections and SMTP verification - 2026-10-28

Completed Connections screen with explanatory service cards, own-account delivery counts, sender-management permission links, refresh and a rate-limited live scanner health check. Backend tests verify account isolation, secret redaction, failed health checks and no email side effects. 35 focused tests passed; full staff/recipient browser flow plus desktop/mobile Connections and accessibility checks passed. Frontend build/format and Ruff lint/Django checks passed. Global Ruff format found a separately added scripts/start_local_maintenance.py formatting issue; this unrelated file was left unchanged.

The user authorized enabling the saved Private Email SMTP profile and resending one captured notification. SMTP authentication succeeded and that notification reached provider_accepted. The running API/worker now use SMTP; previous captured notifications were not bulk-replayed. Inbox receipt is not confirmed, and localhost invitation links still require this computer.
