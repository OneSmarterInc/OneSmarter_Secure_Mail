# OneSmarter Secure Mail

Standalone OneSmarter product. Interactive browser prototype plus tested Python routing policy. **Not production secure email.** No live email, OTP service, or encryption backend is connected. secure.onesmarter.com is not configured. Use sample content only.

## Run

Prototype: `python -m http.server 8080 --directory web`, then open http://localhost:8080.
Tests: `python -m unittest discover -s tests -v`.

## Routing

- Authenticated onesmarter.com sender and all recipients in exactly that domain: normal email.
- External recipients: protected portal by default.
- Standalone case-insensitive Nophi in subject: normal email override.
- Secure-information requests and existing secure conversations always remain protected.
- Supply authenticated sender identity and ALL To/Cc/Bcc envelope recipients. Invalid inputs fail protected.
- Normal means portal bypass, not disabling transport encryption.

Policy is not connected to delivery yet and does not intercept messages composed directly in Proton.

## Separate security dependency

This repository owns portal, routing, invitations/replies, recipient verification, and future Proton integration. OSIVault remains an independent library with its own security reviews and releases. No OSIVault code is vendored or installed here. Pin an approved immutable version after review; never use a moving branch.

## Remaining implementation

Staff authentication; durable tenant-scoped storage; real email OTP throttling/sessions; invitation and reply APIs; attachment handling; audit logs; expiry/revocation; production key management; vetted post-quantum cryptography; Proton sending integration; domain/TLS configuration; end-to-end security tests. Decide notification-only versus full-reply delivery into Proton.

The old combined osivault-secure-mail.patch is superseded. Routing now belongs here; reusable cryptographic fixes remain separate unpushed OSIVault work. Do not apply the combined patch wholesale.
