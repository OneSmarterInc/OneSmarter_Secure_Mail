# V2 review remediation — 29 October 2026

This file records the current source changes against the supplied v2 review. It does not certify deployment, independent cryptographic review, password rotation or off-host custody. Production startup remains blocked. Existing local services and stored keys were not restarted, rotated or migrated during this work.

| Finding | Source status | Implementation and remaining evidence |
| --- | --- | --- |
| N-1 login spraying | Implemented; capacity review pending | Every scope has an IP bucket. Login admits at most 50/IP and 1,000 globally per 300-second refill period before password hashing. Rejected IPs do not charge the global budget. Account failure throttling runs after an incorrect password; correct credentials can reach MFA despite exhausted account failure credits. Failure backoff is token refill (one per 30 seconds), not an exponential sleep or permanent lock. PostgreSQL concurrency/load and shared-NAT sizing remain deployment checks. |
| N-2 old-root snapshots | Implemented for managed copies; off-host closure pending | Explicit backup destination required; no implicit local default. Three committed managed generations retained. Root rotation commits/publishes a full new-root snapshot, then removes managed old-root snapshots and pending copies. Cleanup failure is reported. External copies/host filesystem snapshots require inventory, coordinated retirement and evidence; deleting a file is not guaranteed physical erasure. |
| N-3 re-verification | Implemented and browser/API tested | Idle session identifies the original recipient for fresh code delivery, even if the invitation token changed. No content permission comes from this hint. New code sent automatically on expiry transition; draft and accepted attachments retained in memory. Expiry/revocation/ownership checks still apply. |
| N-4 key-service exhaustion | Implemented for bulk reads; growth/load work remains | Search/list use batches of at most 25 unwraps, one service transaction/audit row per batch, separate 120-batch/minute certificate budget. A 1,000-item search needs 40 calls, not 1,000. Page rendering reuses request-local decoded subjects. No cross-request plaintext/DEK cache. Connections remain bounded per batch. Audit archival and scale testing remain open. |
| N-5 legacy migration | Legacy skip/report implemented; trusted-source recovery required | Unauthenticated v2 rows are counted and skipped so later rows migrate. Deleted attachments skipped. Docs explicitly reject silent legacy re-MAC. Trusted reimport uses verified originals through the existing scanned upload/reply workflow; MFA re-enrollment and fresh notifications replace old secret material. No automatic trusted conversion of an untrusted historical record is claimed. |
| N-6 MFA replay | Implemented in isolated service; external rollback anchor open | Current enrollment data-key digest lives in the key-service database, outside the application row. Re-enrollment rejects previous data keys; rewrap retains the data key and does not break old wrappers after an application rollback. Existing unregistered MFA envelopes fail closed and need trusted re-enrollment. Local-development mode and rollback of the entire key host are not covered. |
| N-7 revoked-certificate throttle | Implemented | Allowlist/expiry checked before authorized budgets. Bulk budget cannot consume individual-operation budget. Denial batches preserve identity within a bounded map, include overflow counts and flush on periodic service ticks/shutdown; failed audit writes log an alert and retain counters. |
| N-8 route 409 loop | Implemented; browser tested | Invalidate preview signature and trigger a new preview; require user review/send again. |
| N-9 repeated reply loss | Implemented; browser tested | Rotate submission key after success; preserve key on uncertain/failed response. Two intentional identical replies have distinct keys. |
| N-10 weak/local recovery | Implemented | Init/root rotation reject zero, repetitive, sequential and printable human-secret inputs. Validator cannot prove entropy; require CSPRNG generation. Local recovery flag requires explicit SYNTHETIC_MODE=true and APP_ENV=development/test. Legacy unseal still permits recovery before rotation. |
| N-11 rate row accumulation | Implemented; scheduler deployment pending | Bounded scheduled removal of rows idle over two days and legacy null timestamps; refill-time index. Current bucket periods are at most one day. Increasing a period requires adjusting cleanup horizon. |
| N-12 SMTP rejection | Implemented | SMTPRecipientsRefused is a definite failure with mail_recipients_refused, not uncertain delivery. |
| N-13 staged cleanup | Implemented; scheduler deployment pending | Celery Beat every 15 minutes, batch 100, only uncommitted uploads older than 24 hours. Failed external deletion is retryable and logged. Committed document retention unchanged. |
| N-14 lost compose response | Implemented | Authenticate current staff and scope idempotency lookup first under organization lock; return an existing matching response before re-evaluating route/sender permission for a new send. No revoked-session bypass. |
| N-15 upload UX | Implemented locally; real interruption validation pending | Explicit cancel, summary live-region updates instead of every percent, remaining queued files marked not accepted after failure, synchronous propagation of accepted files to retained recipient draft. Server cleanup releases failed reservations; crashes/cancelled response loss rely on staged cleanup. |
| N-16 MFA step-up resubmit | Implemented | Account create/edit, delivery retry and audit export resume the pending action after successful step-up; existing idempotency keys preserved. |
| N-17 snapshot correctness/performance | Partial | Pending files published only after commit; rollback discards pending copies; automatic restore rejects .pending; restore checkpoints WAL and fsyncs before publication. Crash between commit/publication still needs operator reconciliation. Full audit-history dump remains under the store lock; scaling and an independent commit/audit anchor remain open. |
| N-18 MFA reset race | Implemented | Reset makes the old password unusable and issues a single-use emailed recovery invitation. Employee chooses a new password before MFA enrollment. Provider delivery and identity-verification procedure remain operational dependencies. |
| N-19 absolute recipient cap | Implemented | Explicit eight-hour lifetime from session creation in addition to 15-minute idle expiry. Fresh verification creates a new session. Migration 0007 and PRD updated. |
| N-20 scroll activity | Implemented | Passive wheel and captured scroll listeners join keyboard/pointer activity; network heartbeats remain throttled. |

## Important remaining release gates

- P0-1: exposed SMTP password rotation cannot be verified here. New processes read EMAIL_HOST_PASSWORD from environment/ignored .env; this does not rotate a credential already cached in a running process or at the provider.
- P0-5: independent review of exact envelope protocol, dependency provenance, vectors, interoperability, custody and required PQ paths.
- Off-host backup destination, recovery custody (quorum/HSM decision), independently anchored audit/replay history, external backup retirement and a coordinated restore drill.
- N-17 audit-history scaling and crash-after-commit reconciliation; do not declare this closed from a successful local restore.
- Approved production sender/provider, region, retention/legal-hold policy and ownership continuity decision. Original ownership remains unchanged.
- Real deployment tests: PostgreSQL concurrency, ingress/proxy, PQ transport, ClamAV, storage, mail delivery, worker/Beat scheduling and load. Synthetic/browser mocks do not supply this evidence.

## Verification

Regression tests are in backend/tests/test_v2_remediation.py and backend/tests/test_rate_limits.py. Synthetic browser checks are scripts/check_v2_ui.mjs: every API request is intercepted, so no mail is sent. The test verifies automatic code request, draft retention, distinct reply keys and refreshed routing preview after 409. Full backend run: 210 passed, 13 skipped. Subsequent focused checks after the final rewrap/replay assertions and cleanup-index migration: 42 passed, 1 external-service test skipped. Ruff lint/format and Django migration drift checks pass; frontend production build passes. The browser check also verifies that the first accepted file survives a second upload returning 401. External-service skips remain deployment gates.

Run from repository root:

```powershell
.venv\Scripts\python.exe -m pytest backend/tests -q --tb=short --basetemp=.runtime/pytest-review-new
.venv\Scripts\python.exe -m ruff check backend
.venv\Scripts\python.exe -m ruff format --check backend
.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
node scripts/check_v2_ui.mjs
```

Run `npm run build` from frontend. Apply migrations 0007 and 0008 only during the coordinated rollout. Deploy the service before the client that calls unwrap-batch. Inventory/resolve legacy content and existing service MFA enrollments before restarting the application on this version.
