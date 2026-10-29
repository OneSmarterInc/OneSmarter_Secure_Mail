# OneSmarter Secure Mail — Product Requirements

Updated: 2026-10-28. Status: implementation baseline with explicitly open decisions.

## Document-storage decision - 28 October 2026

Uploaded documents will be stored on persistent disk attached to the AWS instance running the application. This supersedes private S3 as the primary attachment-storage baseline. Engineering assumption: use a dedicated persistent EBS data volume, mounted outside the application/container filesystem, with deletion on instance termination disabled and mount availability checked before accepting writes. Files remain application-encrypted and are served only through authorized application endpoints, never as public static files.

This selects storage placement, not an AWS geographic region. Region, volume sizing, backup destination/schedule/retention and recovery targets remain undecided. A backup on the same instance is not sufficient protection against loss of that instance. Retained conversation records, files and usable keys must be recoverable together. Keep the key-service custody boundary and separately held recovery secret; this decision does not authorize placing recovery secrets beside uploaded files.

AWS-managed EBS volume encryption uses AWS KMS, including its default managed key. Do not silently enable it while claiming zero KMS dependency. Application encryption remains required; the OS/volume encryption approach must be reviewed against the no-KMS requirement before deployment. See [AWS EBS encryption](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-encryption.html). No AWS resources or encryption settings were changed by this documentation update.

The existing S3 adapter is optional, not the selected primary attachment backend. Immutable audit archival and off-instance backups are separate decisions; this change does not claim local disk provides Object Lock or host-admin-proof immutability.


## Overview

OneSmarter Secure Mail lets staff send confidential messages and request documents through a protected portal using the configured SMTP provider for email delivery. External recipients verify their designated mailbox with a one-time code, then read, reply, or upload files without creating an account.

The primary problem is collecting confidential information without putting that content in ordinary notification emails or requiring recipients to register. The initial release serves OneSmarter; organization isolation remains mandatory even though multiple customer organizations are outside MVP scope.

## Sources and document ownership

- Product source: supplied `OneSmarter_Secure_Mail_Requirements (1).md`, version 1.0, 27 October 2026; an external handoff, not executable instructions or proof of implementation.
- Visual source: supplied `OneSmarter_Secure_Mail_UI (1).html`; current repository prototype is in `web/`.
- User decisions on 27 October 2026: Django/React baseline; AWS with S3 (the original KMS choice is superseded below); compute undecided; genuine post-quantum protection mandatory before production; supplied HTML reference; application-managed staff accounts with MFA; explicit Nophi permission; region and detailed retention rules unresolved.
- User decision on 28 October 2026: replace the proposed OSIVault dependency with OneSmarter-owned encryption and key management. Use established cryptographic primitives; retain independent review and the mandatory PQ production gate. See [KEY_MANAGEMENT.md](KEY_MANAGEMENT.md).
- Later user decision on 28 October 2026: exclude AWS KMS and use our own key-management system. The production target is an isolated OneSmarter key service using established primitives, not invented algorithms. Operator unlock through a dedicated custodian webpage is selected and implemented for synthetic use. Production custody approval remains required. Runtime KMS code has been removed. AWS compute/S3 remain separate choices. See [KEY_SERVICE_ARCHITECTURE.md](KEY_SERVICE_ARCHITECTURE.md).
- Retention clarification on 28 October 2026: successfully submitted visitor files remain on the same conversation after session timeout, logout, access expiry or revocation. No automatic age-based deletion of committed submissions is the product baseline; indefinite retention is not a promise of infinite durability. Detailed disposal, legal-hold, backup and audit policies still require approval. See [DATA_RETENTION.md](DATA_RETENTION.md).
- Additional user requirement on 27 October 2026: administrators use the ordinary staff portal with an extra **Access** tab for staff account creation/management, account details and usage tables, and a dedicated immutable audit-log page with professional search, filters, sorting, and permitted actions.
- [TECH_STACK.md](TECH_STACK.md): architecture and dependency boundaries.
- [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md): visual tokens, components, and interaction rules.
- [RULES.md](RULES.md): coding and verification instructions.
- [ROADMAP.md](ROADMAP.md): observed implementation status and delivery gates.

This PRD owns product behavior and the decision register. Record later explicit product-owner decisions here, then reconcile dependent documents. A proposal is not approved merely because it appears in documentation. Repository code and passing tests establish only the behavior actually exercised.

## Personas and permissions

| Persona | Need | Access boundary |
| --- | --- | --- |
| Staff sender / assigned reviewer | Send protected messages; request, read, and respond to documents | Own or explicitly assigned conversations and approved sender addresses |
| External recipient | Respond easily without registration | Designated mailbox grant and its conversation only |
| Company administrator | Use normal staff workflows plus Access: staff accounts, usage, immutable audit logs, and approved settings | All organizational staff accounts are visible for management; normal conversation permissions still apply; no automatic access to others' confidential content |
| Auditor / support | Investigate delivery and access problems | Approved operational metadata; exceptional content access requires an explicit audited grant |
| Background worker | Deliver jobs, scan files, enforce scheduled operations | Least-privilege service identity and scoped work |

All reads, replies, uploads, and downloads require organization and conversation authorization. Shared mailbox verification demonstrates mailbox access, not a person's legal identity or independent MFA.

## Primary flow: request and receive a document

1. Ammar signs in with staff MFA and chooses **Request secure information**.
2. He selects an approved sender address, Sara's email, optional instructions, and access expiry. Blank instructions are allowed.
3. The server validates the submission and creates a protected conversation, recipient grant, encrypted content records, and an outbox record. Storage/object finalization must recover safely from partial failure.
4. The configured SMTP provider delivers a generic invitation with an opaque portal link. Confidential instructions, subjects, filenames, and files are excluded from the notification by default.
5. Sara opens the link, sees the organization and masked destination, and requests a code. The destination cannot be changed by the visitor.
6. The server sends a real code only to the granted mailbox, verifies it once, and creates a short-lived conversation-scoped session.
7. Sara submits text, files, or both. Empty submission is rejected. Files remain unavailable until validation and scanning permit access.
8. The system stores protected content and records submission success independently of notification delivery. Retries with the same idempotency key represent one logical submission.
9. Ammar receives a generic email notification, signs in to the portal, and reads the submission only after authorization. The service decrypts content for authorized display.
10. Replies stay protected. Expiry or revocation blocks subsequent recipient actions; already downloaded copies cannot be recalled.
11. Accepted files committed to a message remain linked to the original conversation. Session/access expiry is not a deletion trigger; authorized assigned staff retain read access. A new recipient verification may reopen the same thread only while its access grant remains valid. Staged uploads are not completed submissions.

## Other core flows

- **Protected compose:** staff enter To/Cc/Bcc, subject, body/files, expiry; server recomputes routing before any content enters email delivery. Each recipient gets a separate grant and notification without Bcc disclosure.
- **Normal compose:** eligible ordinary messages are delivered through the configured SMTP provider with a visible routing reason. Portal expiry/revocation cannot recall normal email. Preserve supported provider transport protections.
- **Reverification:** logout or session timeout ends access; a new verification is required. Link scanning must not consume a grant or unlock content.
- **Failure recovery:** notification failure leaves stored protected content intact; key-service failure blocks protected operations; failed scans block downloads; interrupted uploads are cleaned up or retried safely.

## Routing contract and precedence

1. Reject malformed input, unauthorized senders, invalid recipients, prohibited files, and invalid empty submissions at the API boundary. Never turn validation failure into normal delivery.
2. Secure-information invitations and existing protected threads remain protected.
3. For an eligible new ordinary conversation, a standalone case-insensitive `Nophi` marker chooses normal delivery only for staff explicitly granted that permission (D06).
4. Otherwise, all recipients must have the exact domain `onesmarter.com` for normal delivery.
5. Any external recipient in To, Cc, or Bcc makes the entire remaining message protected.

Evaluate authenticated identity and every envelope recipient, not an untrusted From header. `sub.onesmarter.com` and `onesmarter.com.attacker.example` are external under this baseline.

Accepted markers include `Nophi`, `Nophi: notes`, and `[NOPHI] notes`. `nonophi`, `Nophiology`, `Nophi_1`, and `no-nophi` do not trigger the override. Preserve the current matching boundaries until an explicit policy change. Retain the marker pending D07.

Show **Normal email — Nophi override** before sending, record the reason and policy version, and never label normal email as inherently unencrypted. Nophi does not classify the content as non-sensitive.

An unauthorized Nophi attempt on a new ordinary conversation must never select normal delivery through the override. Proposed API behavior: reject with an actionable permission error instead of silently choosing a route. Secure-information requests and existing protected threads retain their higher-priority protected behavior. The pure function remains independent of accounts. The Django policy boundary now enforces the explicit permission before persistence/delivery; regression tests cover denial and protected-thread precedence.

The current policy function can return protected for invalid input and short-circuits protected-thread/request flags. It is not an API validator, sender authentication mechanism, or permission grant.

## MVP requirements

| ID | Must-have outcome |
| --- | --- |
| FR-01 | Staff authentication with MFA and authorized sender addresses |
| FR-02 | Compose with To/Cc/Bcc, subject, body, files, and expiry |
| FR-03 | Server-side routing and visible reason; preserve the contract above |
| FR-04 | Dedicated secure-information invitation with optional instructions |
| FR-05 | Generic notification with an opaque link that alone does not authorize reading |
| FR-06 | Single-use email code bound to designated recipient and grant; throttling and scoped session |
| FR-07 | Authorized message/file access and threaded staff/recipient replies |
| FR-08 | Recipient text-only, files-only, and combined submissions |
| FR-09 | Current authorization, expiry, and revocation enforced on every protected request |
| FR-10 | Staff reply notifications by email with portal links |
| FR-11 | Separate delivery, recipient-access, conversation, and per-viewer unread states |
| FR-12 | Authorized search/filter/pagination; searchable fields require D13 |
| FR-13 | Audit metadata without message text, codes, raw tokens, or secrets |
| FR-14 | Durable outbox, bounded retries, idempotent submissions, and controlled notification delivery |
| FR-15 | Sender configuration, service/key health, and actionable failures |
| FR-19 | Administrator-managed staff provisioning and account lifecycle; no public staff self-registration |
| FR-20 | Shared staff portal with an additional authorized Access tab containing Accounts and Audit logs pages |
| FR-21 | Organizational account directory with last login, lifecycle/security details, defined usage metrics, server-side search/filter/sort/pagination |
| FR-22 | Dedicated append-only, immutable-retention audit history with searchable metadata, stable sorting, event details, and authorized exports |
| SEC-01 | Reviewed encryption and key lifecycle for bodies, replies, files, and sensitive metadata |
| SEC-02 | Genuine validated post-quantum protection is mandatory before any production release |
| SEC-03 | OneSmarter-owned key service with no AWS KMS/OSIVault dependency; reviewed root custody, workload authorization, rotation and recovery |
| FR-23 | Committed submissions persist on the same thread independently of visitor-session/access expiry; no automatic timed deletion of submitted documents |
| UX-01 | Mobile and keyboard usability, accessible forms, and clear loading/error/empty states |

## Out of scope for MVP

- Full confidential replies delivered into Proton (FR-16); initial integration is notification-only for protected traffic.
- Intercepting mail composed directly in Proton web/mobile; native compose integration is discovery work (FR-17).
- Browser extensions, Proton partnerships or special APIs, and Tor access (FR-18).
- Anonymous uploads, transferring access by forwarding a link, public file sharing, and recipient account registration.
- Multiple customer organizations as a product offering, advanced business intelligence beyond the required account usage metrics, and full-text encrypted-content search unless separately approved.
- Public staff registration, administrator impersonation, plaintext password display, and editing/deleting historical audit events through the portal.
- Zero-access or client-to-client end-to-end encryption claims; the proposed service manages decryption.
- LLM features, automated content classification, payments, and unrelated integrations.

Post-quantum protection is a release gate, not a deferred nice-to-have. Development with synthetic data can proceed while the architecture is reviewed; do not turn a pilot into an unapproved production exception.

## Administrator experience and staff account lifecycle

Administrators sign in through the same application-managed staff login and MFA flow. They retain the same dashboard, compose, secure-request, assigned conversation, and personal settings experience as ordinary staff. Their additional **Access** navigation item opens two dedicated pages: **Accounts** and **Audit logs**. There is no separate product or unrestricted mailbox view implied by the administrator role.

The Accounts page lists all staff and administrator accounts within the administrator's organization, including invited and deactivated accounts. External recipients are grants, not staff accounts, and do not appear in this directory. Ordinary staff cannot access these pages, underlying APIs, usage totals, or exports by changing a URL. Administrator capabilities are checked server-side and removed promptly when the role is withdrawn.

### Provisioning and management

1. An authorized administrator selects **Create account**, enters the person's name and company email, and selects approved sender addresses and explicit permissions. New accounts default to staff; Nophi defaults off.
2. The system validates organization scope, permitted email/domain, email uniqueness under the documented identity policy, and the administrator's authority to grant each permission. Creating or promoting another administrator requires an explicit privilege-management capability.
3. A short-lived single-use activation invitation is sent to the fixed staff mailbox. The administrator never sees or sends a permanent password. Account creation and invitation delivery have distinct statuses; delivery retries do not create duplicate accounts.
4. The invited employee verifies activation, sets their own password, and enrolls in the approved MFA method before accessing confidential workflows. Expired or superseded invitations cannot activate accounts; suspended/deactivated accounts cannot be activated through old links.
5. Permitted row actions include view details, edit approved profile fields/sender permissions, resend or cancel pending invitation, suspend/reactivate/deactivate, initiate password recovery, revoke sessions, and review that account's audit history. MFA recovery follows a separate verified procedure; it must not silently bypass MFA.
6. Sensitive changes require a clear review/confirmation, recent MFA verification where appropriate, and an audit reason. Passwords, recovery secrets, and MFA seed values are never displayed in account details.

Proposed lifecycle: **Invited → Active → Suspended or Deactivated**; permitted reactivation is an explicit audited action. Activation expiry and temporary authentication lockout are separately represented, not confused with deliberate deactivation. Protect the last active administrator and prevent self-lockout or concurrent role changes from removing all administrative access. Provision the first administrator through a controlled, audited bootstrap procedure, never a public signup route.

Suspension/deactivation revokes staff sessions and blocks subsequent protected operations and new sending. Workers recheck authorization before executing pending user-originated sends. Preserve conversations and audit attribution; ownership/reassignment remains governed by D10 rather than deleting data with the account. Changing a login mailbox requires a dedicated verified flow with session/invitation invalidation, not a casual profile edit.

### Account directory and details

The default table shows name, login email, role, account status, MFA status, last successful login, period usage, and an Actions menu. Account details or configurable secondary columns expose the following fields without requiring an unusably wide table:

| Field | Meaning / behavior |
| --- | --- |
| Account ID, name, login email | Stable identity plus permitted profile fields; email is not a password or sender-authorization proof |
| Role and explicit permissions | Staff/admin, approved sender addresses, Nophi permission; show allowed management actions |
| Account and invitation status | Invited/active/suspended/deactivated; pending/expired/cancelled invitation and delivery failure separately |
| MFA status | Required/not enrolled/enrolled/recovery pending; never secret material |
| Created at / created by | Server timestamp and creator reference; bootstrap accounts identified explicitly |
| Last successful login | Completion of password and required MFA; Never for an account that has not completed login |
| Last activity | Timestamp of the last qualifying authenticated user action; distinguish it from login and background refresh |
| Last modified / status changed | Time, actor, and approved reason where permitted |
| Active sessions | Count and revocation action; no raw session identifiers or cookies |
| Usage | Selected-period activity counts plus current storage/assignment gauges as defined below |

Use server-side search across approved name, email, and account-ID fields; filters for role, status, MFA status, Nophi permission, and login/activity date range; and ascending/descending sorting on supported columns with visible arrows. Default proposal: newest created first, stable account-ID tie-breaker; Never/unknown timestamps sort last in either direction. Provide pagination, result counts, Clear filters, and an explicit no-results state. Proposed page sizes are 25/50/100 with a server-enforced maximum.

### Usage definitions

Usage is operational metadata, not access to confidential content or employee surveillance. Proposed default period: last 30 days, with explicit start/end dates and timezone. Show **Updated at** and report unavailable data as unknown, not zero.

| Metric | Counting rule |
| --- | --- |
| Protected messages / secure requests / normal messages | Separate counts of unique committed staff send/request actions initiated by the account during the period; retries and notification fan-out do not inflate totals; counts do not prove delivery |
| Staff replies | Unique committed replies authored by the account during the period |
| Recipient submissions received | Unique submissions attributed to the assigned staff owner at receipt time; historical attribution does not change after reassignment |
| Files uploaded / bytes uploaded | Accepted file submissions attributable to the uploader or receiving owner at submission time, shown separately; reject/failure counts separate; no multiplication by downloads or retries |
| Current retained storage | Actual encrypted attachment bytes currently stored for conversations assigned to the account, including retained/quarantined versions until removed; timestamped gauge, not an AWS billing estimate |
| Current assigned conversations | Count of presently assigned conversations; separate from historical period activity |
| Delivery failures / pending notifications | Current operational job counts scoped to the account; separate from logical message counts |

Document shared-conversation storage attribution before implementation (D10/D16). Count each object once in organization totals; do not sum overlapping per-account views. These metrics need neither message-body search nor filenames in the directory.

## Immutable audit-log page

The Access → Audit logs page is a dedicated administrator workspace, not a developer console or a list of editable database rows. It shows organizational security and operational events, including the administrator's own actions. Read/export capabilities may be delegated explicitly to an auditor without granting account-management or message-content access.

Record account creation/activation/status/profile/role/permission changes, invitation lifecycle, login successes/failures, MFA/recovery events, logout/session revocation, approved sender changes, Nophi use/denial, conversation access/reply/download/revoke outcomes, notification failures, file scan outcomes, key-operation metadata, settings changes, and audit access/export. Never record submitted passwords, codes, tokens, content, sensitive filenames/subjects, or unrestricted request payloads.

| Event field | Requirement |
| --- | --- |
| Event ID and organization | Unique immutable ID and tenant boundary |
| Occurred at / recorded at | Server-controlled UTC timestamps; distinguish delayed ingestion; UI displays an explicit timezone |
| Actor | Stable account/service/recipient-grant reference, actor type, and role at event time; unknown actors remain unknown |
| Action and category | Defined action codes and human-readable labels such as Account suspended or Nophi denied |
| Target | Resource type and opaque ID; include a target account where relevant, without confidential content |
| Result | Success/failure/denied and safe reason code; distinguish request intent from completed outcome |
| Change metadata | Allowlisted non-secret before/after values or references, reason, correlation/request ID, relevant policy version |
| Integrity/archive state | Verified archive reference or Pending archive / Verification failed; never imply archival protection before confirmation |

Search by event ID, authorized actor/target identity, target resource ID, action code, or correlation ID. Filter by date/time, actor, action/category, target type/account, and outcome. Sort supported timestamp/actor/action/result columns in either direction with visible arrows, stable event-ID tie-breakers, and server-side pagination. Default is newest recorded first. New incoming events must not unexpectedly move rows while an administrator inspects a result page.

Permitted actions: **View details**, **Copy event ID**, **View related events**, and **Export filtered results** for administrators/auditors explicitly allowed to export. Exports are scoped, redacted, bounded or queued, audited, and time-limited; recheck access on download. No Edit, Delete, Clear history, or destructive bulk action exists. Separate linked correction events may explain an error while preserving the original.

**Immutability contract:** historical events cannot be modified or deleted by portal users, including administrators, through UI or API. Retained canonical audit records must also have storage-enforced protection for the approved retention interval; application-level append-only code alone is insufficient. Keep a searchable projection with reconciliation against the protected archive, show ingestion/archival health, detect gaps/tampering, and preserve original attribution after account deactivation. Do not promise protection against every infrastructure compromise or indefinite retention without an approved design. D15 covers archive retention, evidence, controlled end-of-retention disposal, and any minimized network/device metadata; it does not make immutable logs optional.

## Security and privacy outcomes

- Protect data in transit and at rest; do not leak confidential content into notifications, telemetry, queues, browser persistence, or backups.
- Keep wrapping keys controlled by the managed key service. The backend may temporarily receive data keys and plaintext for approved processing; this is a trusted-service design.
- Use reviewed, versioned envelopes and authenticated organization/conversation/message/object context. Document key rotation, old-version recovery, and backup restoration.
- Validate genuine PQ mechanisms separately for browser-to-service, stored-content/key-establishment, and service-to-email-provider paths. A signature, ordinary TLS, AES label, AWS KMS adoption, or an in-house cryptographic implementation alone is not acceptance evidence. D03 defines exact coverage and proof.
- Apply staff MFA, recipient OTP throttling, protected session cookies, CSRF controls, per-request authorization, and token/code redaction.
- Keep attachments private and quarantined until approved scanning completes; preserve Bcc privacy.
- Access expiry does not imply deletion. Retention, legal hold, export, and jurisdiction requirements must be decided before real-data use.

## Proposed operational defaults — not yet approved

| Setting | Proposal | Open detail |
| --- | --- | --- |
| OTP | Six digits, ten minutes, one use | Aggregate issue/attempt limits and delivery lifecycle |
| Attempts | Five per challenge | Recipient, grant, IP, and sender abuse limits |
| Resend | Thirty-second cooldown | Hourly/daily caps and replacement of prior challenges |
| Recipient session | Fifteen minutes | Idle versus absolute expiry |
| Recipient access | Seven days; one/seven/thirty-day choices | Staff access and conversation lifecycle are separate |
| Attachments | Ten files, 25 MB combined | Approved types, per-file limits, scan engine |
| Recipient replies | Private recipient-to-staff by default | Group and reply-all behavior |

## Acceptance and success measures

A release must demonstrate the complete Ammar/Sara flow with actual delivery evidence, authorized reading, and effective revocation. It must also demonstrate internal/external/mixed routing, exact Nophi behavior, and protected-thread/request precedence.

Required negative cases include forwarded links, wrong/expired/reused codes, concurrent verification, revoked active sessions, cross-organization/object access, Bcc exposure, duplicate requests, malicious files, key unavailability, ciphertext/context tampering, and unsupported PQ algorithms without silent downgrade.

Administrator acceptance also requires: staff denied direct Access/API/export access; admin ordinary conversations remain scoped; create/invite/activate with MFA; duplicate creation handled safely; suspended sessions and pending sends denied; role/Nophi changes enforced immediately; last-administrator concurrency protected; last-login recorded only after MFA; usage not inflated by retries; accessible server-side sorting/search/pagination; audit mutations denied even to admins; archive overwrite/deletion rejected during retention; corrections append rather than replace; export scope/redaction audited; archive failure/gaps visible and recoverable.

Track invitation-to-submission completion, notification outcomes, verification failures, scan failures, queue delay, key-service failures, and restore results using non-sensitive operational metadata. Numeric latency, availability, recovery-time (RTO), and acceptable data-loss (RPO) targets remain D12; do not invent service guarantees.

## Decision register

| ID | Decision | Status / accountable role |
| --- | --- | --- |
| D01 | Django 5.2 LTS + DRF, React 19 + TypeScript, PostgreSQL, Celery/Redis, Docker | Implemented baseline; exact installed dependencies recorded in requirements.lock and frontend/package-lock.json |
| D02 | Hosting and private storage | AWS application instance with attached persistent document storage; supersedes primary S3 storage. AWS KMS remains excluded. Instance specification, region, networking, backups and database/broker placement remain open; engineering/operations |
| D03 | Genuine PQ protection before production | Mandatory by user decision; exact algorithms, coverage, compatibility, and acceptance evidence open; security + product owner |
| D04 | Supplied HTML visual direction | Selected reference; accessibility refinements in DESIGN_SYSTEM.md |
| D05 | Staff authentication provider and MFA recovery | Application-managed accounts implemented with authenticator TOTP, single-use recovery codes, admin-issued password recovery and session revocation; production recovery policy still needs approval |
| D06 | Who may use Nophi | Explicit permission only; backend enforcement and actionable rejection implemented and tested |
| D07 | Strip Nophi and/or require acknowledgement | Open; retain marker pending decision; product |
| D08 | Retention, deletion, legal hold, exports, data residency | Committed submissions have no automatic age-based deletion and survive access/session expiry. Detailed disposal/legal-hold, audit/export/backup periods and region remain unresolved before real-data use; see DATA_RETENTION.md |
| D09 | OTP/session/attachment default approval | Proposed table above; product/security |
| D10 | Shared ownership, assignment, exceptional administrator access | Open; product/security |
| D11 | Per-recipient/group reply visibility and revocation scope | Private recipient-to-staff proposed; product/security |
| D12 | Latency, availability, RTO/RPO, operating budget | Open; product/operations |
| D13 | Searchable fields with encrypted subject/body | Metadata-first proposed; product/security/engineering |
| D14 | Administrator provisioning and Access workspace | Required by user: normal staff portal plus Accounts and Audit logs; controlled activation/lifecycle and permission model specified above |
| D15 | Immutable audit storage and retention | Immutable logs required by user; archive mode/duration, export limits, metadata minimization and disposal approval open; resolve with D08 before real-data use |
| D16 | Account usage details and table defaults | Required by user; current 7/30/90-day counters and retained-storage gauges implemented; shared ownership remains outside current assignment model |
| D17 | Cryptographic implementation ownership | User requires our own system, replacing OSIVault. OneSmarter v2 envelopes, key versions, rotation and migration implemented using cryptography; protocol/PQ coverage review remains mandatory |
| D18 | No external managed KMS | User excludes AWS KMS; isolated OneSmarter key service is the target. Runtime KMS adapters/settings removed; S3 uses SSE-S3; isolated candidate and custodian webpage implemented, production approval pending |
| D19 | Root custody and service operation | Operator-unlocked versus hardware-backed custody, quorum/custodians, boot/unseal and recovery procedures remain open. A local development root file is not a production solution |

## Terminology

- **Grant:** permission for one designated mailbox to access a conversation.
- **Outbox:** durable database record of work that must happen after a business transaction.
- **Idempotency:** retries represent one logical action rather than duplicate records.
- **Data key / DEK:** encrypts content; stored long-term only in protected form.
- **Wrapping key / KEK:** protects data keys; managed separately from stored content.
- **PQ:** post-quantum; requires evidence for the specific mechanism and path being claimed.

## SMTP provider selection update - 28 October 2026

The user selected Private Email (`mail.privateemail.com`, port 587 STARTTLS) and `info@kormic.ai` for the local SMTP profile, superseding the earlier Proton delivery plan. Secrets remain outside tracked files. Provider credentials are configured but real sending has not been exercised; delivery/bounce limits and authorized From-address mapping remain release requirements. Protected traffic stays notification-only. Earlier Proton-native integration exclusions are historical and do not grant a new integration scope.

## Antivirus implementation update — 2026-10-28

Real ClamAV is the default for uploads; synthetic scanning requires explicit development/test configuration. Compose provides an isolated Unix socket, persistent signature updates and resource limits. The application checks loaded signature age before accepting a scan and rejects unavailable/stale/invalid results. Accepted files are encrypted after scanning. See [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md#clamav) for configuration, actual test evidence and nested-content limitations. This does not remove the production security-review gate.

## Portal separation and deployment interface - 2026-10-28

Staff and administrators require exact @onesmarter.com accounts. Recipients may use any valid mailbox. Staff enter through /staff/; invitation links enter through /recipient/ and use a separate API namespace and session cookie. Normal user pages no longer display development banners, test-mailbox controls or engineering release requirements. Operator test tools require explicit opt-in. Local captured notifications are explicitly marked not emailed. This supersedes earlier instructions to show development-mode banners on customer pages; deployment status remains documented and enforced on the server. See [DEPLOYMENT.md](DEPLOYMENT.md) for compatibility, configuration and outstanding release blockers.
