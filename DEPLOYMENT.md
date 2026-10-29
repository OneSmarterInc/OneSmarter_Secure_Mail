# Deployment handoff

## Implemented portal boundary

- Staff/admin UI: `/staff/` (the root URL remains a compatible staff entry point).
- Recipient UI: `/recipient/#/invite/<opaque-token>`. A recipient without a link sees instructions, not staff login.
- New recipient invitations use `RECIPIENT_PUBLIC_URL`; staff notifications and account activation use `PUBLIC_URL`.
- Recipient endpoints are allowlisted under `/recipient-api/`. Staff endpoints remain under `/api/`. The recipient namespace has no account management, staff login, audit or setup routes.
- Staff and recipients use different session cookies. The recipient cookie is scoped to `/recipient-api/`; both cookies remain HTTP-only and become Secure under the protected deployment policy. Cookie domains remain host-only. CSRF is still enforced.
- Legacy `/api/recipient/*` routes are disabled by default and unavailable in production. Historical regression fixtures explicitly opt in through `ENABLE_LEGACY_RECIPIENT_API` in synthetic mode only. Existing invitation links redirect to the new recipient entry point.
- `@onesmarter.com` is an exact staff/admin email-domain restriction. Recipient mailboxes may use any valid email domain and require invitation-bound OTP verification.

`PUBLIC_URL` and `RECIPIENT_PUBLIC_URL` are public origins plus their entry paths, not email domains. Set recipient URLs with the `/recipient` path. Both virtual hosts must proxy the respective APIs to the application and serve the built frontend. Use host-only cookies; do not set a parent-domain session cookie. Separate DNS names alone do not enforce API isolation: the ingress must restrict the API namespace on each host if separate hosting is selected.

## Customer interface and operator tooling

The global development banner, test mailbox link and release-checklist panel have been removed from normal user pages. The test mailbox API and its hidden UI require `ENABLE_DEV_TOOLS=true` and remain restricted to loopback synthetic operation. Leave this setting false on shared deployments. Browser tests enable it only in their disposable environment. Production edge configuration explicitly denies web bootstrap and test-mailbox endpoints. Create the first administrator through `manage.py bootstrap_admin` after release approval.

A historical locally captured notification is labelled **Not emailed - local capture only**. It must never be relabelled as sent. Switching to SMTP will not resend previously captured messages automatically. Email requires sender credentials and authorized provider configuration; a localhost invitation cannot be opened by an external recipient on another computer.

## Release status: blocked

The clean interface is not production certification. `deploy/production.env.example` is a configuration handoff; production startup remains deliberately blocked. Do not use `APP_ENV=development` to bypass it on a public host.

Outstanding work includes independent hybrid-crypto review; approved PQ ingress/key/scanner/recovery coverage; custody and coordinated restore evidence; actual SMTP/delivery tests; immutable audit storage; region and backup/disposal policies; container resource/load verification. The selected instance-mounted persistent document storage also needs its production adapter/mount checks: the current local storage adapter is restricted to synthetic mode and the optional S3 adapter is not the selected document-storage target. See RELEASE_GATES.md and OPERATIONS_RUNBOOK.md.

The existing PQ ingress candidate now proxies both API namespaces and denies development endpoints. It still requires a compatible reviewed nginx/OpenSSL build, certificates, private socket permissions and deployment validation. No DNS, AWS resources, real email or public deployment was changed by this work.

## Trusted proxy and token buckets (29 October 2026)

The edge overwrites `X-Real-IP` with its socket peer and removes incoming
`X-Forwarded-For` / `Forwarded` assertions. Django trusts this single IP only
when the immediate peer is explicitly configured in `TRUSTED_PROXY_IPS` (exact
addresses; default empty). Missing/malformed assertions from a trusted peer
are rejected. Untrusted peers cannot override their socket address.

Compose sets `TRUSTED_PROXY_IPS=127.0.0.1`; nginx and Gunicorn share a network
namespace and Gunicorn binds only loopback. Do not publish the backend port.
For native Vite development, its proxy also overwrites these headers; set the
same variable on the API process. Loopback trust includes other local processes,
so use only on a trusted development machine. Never trust a broad Docker/private
subnet. A load balancer in front of nginx requires a separately reviewed real-IP
configuration; these templates assume nginx is the direct client-facing edge.

The PQ template uses `TRUSTED_PROXY_UNIX_SOCKET=true` only with Gunicorn bound
exclusively to the restricted Unix socket. Empty `REMOTE_ADDR` is trusted only
under this explicit option; it never grants trust to TCP peers. Socket ownership
must restrict writers to the gateway and application operators.

Each identified operation consumes tokens from both an identity-wide bucket and
an identity-plus-client-IP bucket. This preserves protection against source-IP
rotation without giving all accounts behind NAT one small allowance. Anonymous
landing/bootstrap requests use a client-IP bucket. Shared public-IP users still
share anonymous limits; distributed attacks and aggregate traffic need separate
edge capacity controls. An attacker can exhaust a targeted identity allowance;
this is the intentional account brute-force limit, not an organization-wide lock.

Existing `maximum` is bucket capacity; `seconds` is time to refill a completely
empty bucket. Login holds 10 tokens and refills one per 30 seconds; MFA holds 5
and refills one per 60 seconds. Integer credits preserve fractional refill,
cap at capacity, and are updated under database row locks. Exhaustion returns
429 without restarting a fixed window. A request denied by one applicable bucket
still counts as an attempt in the other. Backwards clock movement cannot mint
extra tokens; synchronized host clocks remain operationally necessary.

Migration `0006_token_rate_buckets` replaces transient fixed-window counters.
Stop old application/worker processes, apply `python manage.py migrate`, and
restart with matching code/configuration. This rollout resets rate allowances;
no accounts, conversations or documents are removed. Do not run mixed old/new
application versions against the changed rate-bucket schema.
