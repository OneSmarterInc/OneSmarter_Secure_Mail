# Application API reference

Updated 2026-10-28. Same-origin session-cookie API under `/api`. Unsafe methods require `X-CSRFToken`; retrieve it from `GET /auth/session`. Browser authentication is never stored as a bearer token in localStorage. Errors use `{ "error": { "code": "...", "message": ... } }` and safe HTTP status codes.

## Staff authentication

| Method / path | Request / behavior |
| --- | --- |
| GET `/auth/session` | Returns CSRF token, verified user or null, synthetic mode and initial-setup availability |
| POST `/auth/setup` | Synthetic loopback-only first administrator; `{email, password}` |
| POST `/auth/login` | `{email, password}`; creates a five-minute pre-authentication session, not staff access |
| POST `/auth/enroll` | Pre-authentication only; enrollment secret/QR URI shown only to its owner |
| POST `/auth/verify` | `{token}`; TOTP or single-use recovery code; establishes staff session and post-MFA last-login timestamp |
| POST `/auth/step-up` | `{token}`; refreshes authorization for sensitive operations |
| POST `/auth/activate` | `{token, password}`; consumes account/recovery invitation; still requires MFA |
| POST `/auth/logout` | Ends the session |

## Conversations and files

| Method / path | Behavior |
| --- | --- |
| GET `/dashboard` | Counts for the authenticated user's conversations |
| GET `/settings` | Non-secret provider/readiness configuration |
| POST `/routing/preview` | Validated compose payload; computes route and permission checks |
| GET `/conversations` | Own conversations; `q`, `state`, `sort`, `page`, `page_size` |
| POST `/conversations` | Creates conversation, encrypted message and durable outbox atomically; idempotency required |
| GET `/conversations/{uuid}` | Own thread and delivery/access states; administrators have no universal content privilege |
| POST `/conversations/{uuid}/messages` | Protected reply; `{body, attachments, audience?}`; idempotency required |
| POST `/conversations/{uuid}/revoke` | `{}` for all recipient grants or `{grant_id}` for one; normal email cannot be recalled |
| POST `/attachments` | Staff multipart `file`; returns accepted staged file ID, name, size and scan status |
| GET `/attachments/{uuid}` | Authenticated authorized download; no persistent public S3 URL |
| POST `/delivery/{uuid}/retry` | Owner and recent MFA; `{acknowledge_duplicate_risk:true}`; failed/uncertain states only |

Compose payload: `{sender, to:[], cc:[], bcc:[], subject, body, mode:"ordinary"|"secure_request", expiry_days:1|7|30, attachments:[]}`. Secure requests may have blank title/instructions. Ordinary messages require a subject and text or files. At most 50 total recipients, 10 attachments and 25 MB combined. All To/Cc/Bcc addresses affect routing.

`Idempotency-Key` is required on compose, reply and account creation; at most 100 characters. Reusing it with a different validated payload returns 409. UUID keys are suitable. Resource ownership is checked on every action, not inferred from unguessable IDs.

## Recipient access

| Method / path | Request / behavior |
| --- | --- |
| POST `/recipient/landing` | `{token}`; returns organization and masked mailbox only |
| POST `/recipient/code` | `{token}`; queues a code to the fixed grant mailbox |
| POST `/recipient/verify` | `{token, code}`; consumes one code and creates a conversation session with a 15-minute idle timeout |
| GET `/recipient/conversation` | Current grant's permitted messages/files, without other recipient identities |
| POST `/recipient/conversation` | `{body, attachments}`; private to assigned staff; idempotency required |
| POST `/recipient/attachments` | Multipart upload scoped to the verified recipient grant |
| POST `/recipient/logout` | Revokes the recipient session |

Invitation and activation secrets are in URL fragments, then POST bodies, not server request paths. Codes expire after ten minutes, have five verification attempts and a thirty-second resend cooldown; additional IP/mailbox limits apply. New codes supersede older challenges. Expiry/revocation is checked even for previously verified sessions.

## Access expiry is not document deletion

Recipient-session expiry/logout returns the verification-required state; it does not delete committed messages or attachments. Reverification uses the same conversation while the grant is still valid. Expired/revoked grants cannot be revived by obtaining another code. Staff conversation/detail downloads remain available to the authorized owner after recipient access ends. Current reply operations reject expired/revoked conversations, including staff replies; no renewal endpoint is implied.

Committed submissions have no automatic age-based deletion. A successful multipart upload is initially staged; it becomes a retained conversation attachment when a message submission commits it. Cleanup of staged/superseded objects must never remove the final committed object. See [DATA_RETENTION.md](DATA_RETENTION.md).

## Internal key-service target — not an implemented portal API

AWS KMS is excluded from the production design. The proposed OneSmarter service exposes scoped wrap, unwrap, rewrap, key-version activation and safe status operations only to authorized workloads/administrators. It does not expose persistent private/root keys or use browser session cookies as service credentials. Implemented internal routes and authorization are documented in KEY_SERVICE_OPERATIONS.md; independent review remains required. Existing application routes remain unchanged. See [KEY_SERVICE_ARCHITECTURE.md](KEY_SERVICE_ARCHITECTURE.md).

## Administration

| Method / path | Behavior |
| --- | --- |
| GET `/admin/accounts` | Organization-scoped directory; `q`, `role`, `status`, `mfa_confirmed`, `can_nophi`, `days`, allowlisted `sort`, pagination |
| POST `/admin/accounts` | `{name,email,role?,sender_addresses?,can_nophi?,can_manage_privileges?,can_export_audit?}`; invitation flow, recent MFA, explicit privilege checks |
| GET `/admin/accounts/{int}` | Safe account metadata, usage and invitation state; never passwords or MFA secrets |
| POST `/admin/accounts/{int}` | `{action,reason,...}`; edit, permissions, suspend, reactivate, deactivate, resend/cancel invitation, recovery, revoke sessions |
| GET `/admin/audit-events` | Metadata search/filter, signed snapshot boundary, sorting and pagination |
| GET `/admin/audit-events/{uuid}` | Immutable event details and archive evidence |
| POST `/admin/audit-exports` | Approved filters/snapshot, export permission and recent MFA; creates ten-minute download authorization |
| GET `/admin/audit-exports/{uuid}` | Rechecks current owner/admin/export permission; safe CSV of at most 10,000 matching events |

Table page sizes are 25/50/100. Audit filters include `q`, `actor_id`, `action`, `target_type`, `target_id`, `outcome`, `from`, `to`. Date-time values must contain a timezone. Pagination reuses the signed snapshot so new events cannot move into already inspected result pages. Search/projection access is itself audited.

The last active administrator and last active privilege manager cannot remove their own remaining administrative authority. Privilege changes invalidate existing sessions. Account deactivation preserves retained records; it is not account deletion.

## Development-only endpoint

`GET /dev/inbox` captures the most recent synthetic notifications only when synthetic mode, development mail provider and loopback origin all apply. It intentionally exposes fictional activation links/codes like a local mail catcher. It must remain unavailable in a production environment.

## Reviewed routing and recipient changes (29 October 2026)

Ordinary compose requires `expected_route: {protected: boolean, reason: string}`
matching the preview. A mismatch/missing confirmation returns `409 route_changed`
without creating a conversation. `nophi_override: true` requires permission and
`nophi_acknowledged: true` on send. Subject text alone never activates Nophi.
Secure requests and protected replies cannot downgrade.

POST `/recipient-api/recipient/activity` extends an unexpired authorized session
by 15 minutes in response to user interaction. Background GET polling does not
extend it. Expired sessions return 401 and require a fresh code; expired/revoked
or inactive-owner grants remain unavailable. Drafts stay only in browser memory
during re-verification, are cleared on explicit lock/unavailable grant, and do not
survive closing/reloading the page. Re-verification never bypasses attachment grants.


## P2 remediation update (2026-10-29)

See [P2_REMEDIATION.md](P2_REMEDIATION.md) for capability configuration, required idempotency headers, administrator MFA reset, staged quotas, evidence and limitations. P2-10 remains partial: metadata caching does not remove all remote crypto calls from transaction locks. Production approval and trusted legacy-envelope migration remain blocked.


## P3 hardening update

See [P3_REMEDIATION.md](P3_REMEDIATION.md) for stable rotation IDs/expected versions, recipient URL cleanup, bounded encrypted-subject search, and deployment verification limits. Rotation retries must reuse the original operation parameters.
