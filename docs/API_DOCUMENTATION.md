# API

`/api/v1` — the HTTP surface (§56).

Everything below is implemented, tested and reachable. Endpoints the
specification calls for but that no phase has built yet are listed at the end
under **Not built yet**, so this document describes the API that exists rather
than the one intended.

---

## Shape

Every response, success or failure, is one of two shapes (§83).

```json
{ "success": true, "data": { } }
```

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields need attention.",
    "requestId": "9f1c…",
    "fields": [{ "field": "email", "message": "is not an email address" }]
  }
}
```

`fields` appears only on `VALIDATION_ERROR`, where the caller has to know what
to fix. Nothing else is ever added: no stack trace, no SQL, no table name, no
hostname. When something breaks, the detail goes to the log keyed by the same
`requestId` the caller is given, and an operator rejoins the two.

### Codes

| Code | Status | Means |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | The input was rejected. See `fields`. |
| `UNAUTHENTICATED` | 401 | No usable session. |
| `FORBIDDEN` | 403 | Authenticated, not permitted. |
| `CSRF_REJECTED` | 403 | A cookie-authenticated mutation that did not come from the site. |
| `MFA_REQUIRED` | 403 | A privileged account that has not cleared a second factor. |
| `NOT_FOUND` | 404 | No such resource, or none the caller may see. |
| `METHOD_NOT_ALLOWED` | 405 | Wrong verb. `Allow` names the right one. |
| `CONFLICT` | 409 | The change contradicts current state. |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 256 KiB. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Body was not `application/json`. |
| `ACCOUNT_LOCKED` | 423 | Too many failed sign-ins. `Retry-After` is set. |
| `RATE_LIMITED` | 429 | Endpoint budget exhausted. `Retry-After` is set. |
| `INTERNAL_ERROR` | 500 | Our fault. Quote the `requestId`. |
| `SERVICE_UNAVAILABLE` | 503 | A dependency is down; the database, usually. |

### Headers

Every response carries `cache-control: no-store`,
`x-content-type-options: nosniff` and `x-request-id`. An inbound
`x-request-id` is honoured so a trace survives the proxy hop, but only if it
matches `^[A-Za-z0-9_-]{8,64}$` — otherwise it is replaced, because the value
is echoed into logs and into the error envelope.

---

## Authentication

Two mechanisms, both carrying the same opaque 256-bit access token.

**Cookies**, for the site itself:

| Cookie | Lifetime | SameSite |
| --- | --- | --- |
| `__Host-mnf_at` | 15 minutes | `Lax` |
| `__Host-mnf_rt` | 30 days, single use | `Strict` |

Both are `HttpOnly`, `Secure`, `Path=/`, and carry no `Domain` — which the
`__Host-` prefix makes a browser enforce rather than a convention we maintain.

**`Authorization: Bearer <token>`**, for anything that is not a browser. The
header wins when both are present.

### CSRF

A mutating request authenticated **by cookie** must carry an `Origin` matching
this site. A missing or foreign `Origin` is `CSRF_REJECTED`.

The rule does not apply to bearer-authenticated requests. A browser never
attaches that header on its own, so a cross-site page cannot cause an
authenticated request with one, and requiring an `Origin` there would break
non-browser clients for nothing.

### Second factor

An account holding any privileged grant must clear MFA before its session is
usable. Sign-in succeeds and returns `mfaRequired: true`; every other endpoint
answers `MFA_REQUIRED` until the factor is presented. The endpoint that accepts
it is Phase 1d.

---

## Endpoints

### `GET /api/v1/health`

Liveness. Public. The only endpoint that answers while the database is down —
that is its job.

```json
{ "success": true, "data": { "status": "ok", "database": "up" } }
```

Always 200 when the process is alive. A monitor that cares about the database
reads the field; returning 503 here would have an orchestrator restart a
healthy process because a dependency blinked.

---

### `POST /api/v1/auth/register`

Public. 10/min per address.

```json
{ "email": "reader@example.com", "password": "…", "displayName": "Ada" }
```

→ `202` `{ "message": "Check your email to finish setting up your account." }`

The response is identical whether or not the address was already registered.
That is deliberate: a signup form that distinguishes the two is an account
enumeration oracle (§77). A collision is recorded in the audit log, where an
operator can see it and a prober cannot.

Accounts are created `PENDING` with the `READER` role and nothing else. A body
carrying `role`, `status` or any other unexpected field is rejected with `400`
rather than having it ignored — see **Unknown fields** below.

---

### `POST /api/v1/auth/login`

Public. 10/min per address, on top of a per-account lockout after 10 failures
in 15 minutes.

```json
{ "email": "reader@example.com", "password": "…" }
```

→ `200` `{ "user": { "id", "displayName" }, "mfaRequired": false, "expiresIn": 900 }`
plus both cookies.

A wrong password and an unknown address return the same `401` with the same
message. A suspended account is only disclosed *after* the password verifies —
before that it would be one more bit about an account the caller cannot prove
they own.

Sign-in never adopts a token the caller supplied. Both tokens are minted
server-side, so session fixation has no path in.

---

### `POST /api/v1/auth/refresh`

Public (the cookie authenticates it). 60/min.

Reads `__Host-mnf_rt`. **Only** from the cookie: a long-lived credential in a
body or query string ends up in a proxy log.

→ `200` `{ "expiresIn": 900 }` plus two fresh cookies. Both tokens rotate;
leaving the access token alone would keep a captured one live for its full
remaining lifetime.

Presenting a **consumed** refresh token revokes the entire session and returns
`401`. Either it leaked or a client replayed it, and those are
indistinguishable from outside — refusing just the token would leave a live
session an attacker may also hold (D-013).

---

### `POST /api/v1/auth/logout`

Authenticated.

```json
{ "all": false }
```

→ `200` `{ "signedOut": true }`, both cookies expired.

The session is revoked server-side. Clearing cookies alone would be theatre:
an already-captured token would keep working, and "sign out" on a shared
machine would protect nobody. `"all": true` ends every session for the account.

---

### `GET /api/v1/auth/session`

Authenticated.

```json
{
  "user": { "id", "displayName", "email", "status" },
  "permissions": ["news.read", "rewards.earn", "surveys.respond"],
  "scopes": [{ "permission", "scope", "countryCode", "cityId" }],
  "mfa": { "required": false, "satisfied": true }
}
```

Takes no identifier, by design. The user described is whoever the token
resolves to, and no input can redirect that — an endpoint with nothing to
tamper with cannot have an IDOR.

Returns permissions, not role names. A client rendering a menu needs to know
what is permitted; telling it the role invites it to decide *by* role, which is
the check §6 says must never be the real one.

---

### `GET /api/v1/news`

Public. 120/min.

| Parameter | Notes |
| --- | --- |
| `limit` | 1–100, default 20 |
| `cursor` | Opaque. From `nextCursor`. |
| `category` | Category slug |
| `city` | City slug |
| `urgent` | `true` restricts to breaking and live |

→ `200` `{ "items": [ … ], "nextCursor": "…" | null }`

Keyset pagination on `(published_at DESC, id DESC)`. An offset over a table
that grows at the head reads duplicates and skips rows; a cursor does not, and
it does not invite a request for page 50,000. A malformed cursor restarts the
listing rather than erroring.

Only `PUBLISHED` rows are reachable, and that is enforced in the repository
rather than here — a route that forgot to filter could not leak a draft.

---

### `GET /api/v1/news/{slug}`

Public. 240/min.

→ `200` `{ "article": { …, "body": ["…"] }, "related": [ … ] }`

An unpublished story and a slug that never existed both return `404`.
Distinguishing them would confirm unpublished work to anyone who can guess a
headline.

---

### `GET /api/v1/categories`, `GET /api/v1/cities`

Public. 120/min. `{ "items": [ … ] }`.

Cities are flat for now. §22's country → state → district → city → locality
hierarchy arrives with the location work rather than being faked with a shape
the database cannot fill.

---

## Unknown fields

A body or query string carrying a field the endpoint does not accept is
rejected with `400`, naming the field.

This is the parameter-tampering defence (§53). Silently dropping `role:
"SUPER_ADMIN"` would be equally safe and would hide the attempt; rejecting it
makes the attempt a logged event with a request id attached.

## Limits

Bodies are capped at 256 KiB. Rate limits are per endpoint and, today, per
process — the counter is in memory. `login_attempts` in the database is the
control that is shared, durable, and unaffected by instance count; the
in-memory limit protects the endpoint, the database one protects the account.
A shared counter arrives with Redis in §65.

## Not built yet

`/reporters`, `/reporter-training`, `/certificates`, `/editors`,
`/editor-assignments`, `/advertisers`, `/campaigns`, `/ads`, `/boosts`,
`/polls`, `/surveys`, `/assignments`, `/interviews`, `/stories`,
`/businesses`, `/wallet`, `/rewards`, `/commissions`, `/revenue`,
`/analytics`, `/notifications`, `/fraud`, `/admin`, `/ai`, `/search`,
`/events`.

Also absent from what is built: email delivery, so the verification token is
issued and stored but never sent; the MFA challenge endpoint, so a privileged
account can sign in but not yet act; and ownership checks, which arrive with
the first resource a user can own.
