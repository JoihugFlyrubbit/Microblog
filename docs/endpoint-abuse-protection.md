# Public Endpoint Abuse Protection

This project treats page-view totals as approximate analytics and login throttling
as defense in depth. Neither CORS nor request-origin checks are authentication.

## Platform decision

- Cloudflare WAF rate limiting is useful for a custom domain whose zone is owned
  by the deployer. The provided `*.pages.dev` hostname is not a deployer-owned
  zone, so this repository does not assume that its owner can attach zone-level
  WAF rules to that hostname. WAF rules remain an optional outer layer after a
  custom domain is added.
- Workers Rate Limiting bindings are the primary short-window protection. They
  run before bcrypt and D1 writes, are supported by the repository's Wrangler
  version, and have a local simulation. Their counters are permissive,
  eventually consistent, and local to a Cloudflare location, so they reduce
  abuse cost rather than provide exact global accounting.
- A Pages Function subrequest to a Worker in another zone does not preserve the
  visitor in `CF-Connecting-IP`; Cloudflare documents a fixed Worker client IP
  for that case. The proxy therefore forwards the original edge-provided source
  in a short-lived HMAC-signed header. The API verifies the signature before
  using that source as a rate-limit key. The shared secret is runtime-only and
  must never be committed.
- Origin allowlisting and `Sec-Fetch-Site` rejection filter obvious browser
  cross-site requests before the rate limiter. Scripts can forge these headers,
  so they are not the primary control.
- D1 remains only as a second login layer for recent failures from one source.
  The global failure lock is removed. D1, KV, and Durable Objects were rejected
  as the first layer because per-request persistence would retain identifiers
  and/or move write amplification to another store. Durable Objects also add a
  new stateful component and billing surface.
- Analytics Engine could absorb high-volume event writes, but replacing the
  existing daily D1 summary would change query and counting semantics. It is not
  needed for this targeted change. Turnstile is also not used: public page views
  must stay interaction-free, and login can add risk-triggered Turnstile later
  only with mandatory server-side Siteverify validation.

Workers Rate Limiting does not create application-owned visitor storage. It is
subject to normal Workers request quotas; this change adds no KV, Durable Object,
Analytics Engine, or paid WAF dependency. The binding namespace IDs are ordinary
configuration rather than secrets, but must be unique within a Cloudflare
account to avoid unintentionally sharing counters with another Worker.

## Request and failure semantics

- A normal public-home mount sends one `POST /analytics/page-view` and counts one
  daily D1 view after origin, fetch-metadata, source, and rate-limit checks pass.
- A source can record up to six views per 60-second Cloudflare-location window.
  Further refreshes receive `429` and do not write D1. Missing or rejected
  origins do not count. Preview traffic counts only when its exact origin is in
  `ALLOWED_ORIGINS`; local development counts against the local simulation.
  Bots that can imitate allowed requests may still count within these limits.
- The public UI ignores analytics failures, including `429` and unavailable
  bindings. A missing or failed analytics limiter returns `503` without writing
  D1, so the homepage remains available while counting stops safely.
- Login allows five attempts per source per 60-second edge window, followed by
  a `429` with `Retry-After: 60`. Requests that pass it are still blocked after
  eight recent failures from the same source in 15 minutes, with
  `Retry-After: 900`. Failures from other sources never trigger a global lock.
- A missing or failed login limiter returns `503` before bcrypt and login-log
  access. Error responses do not expose whether the administrator exists or any
  internal counter value.

The proxy passes an IP address only transiently between the Pages Function and
API Worker. Page-view rows continue to contain only date and aggregate count.
No page-view IP, User-Agent, fingerprint, or derived visitor identifier is
stored by the application. Existing security login logs continue to store the
source IP and User-Agent; their retention policy is intentionally outside this
change.
