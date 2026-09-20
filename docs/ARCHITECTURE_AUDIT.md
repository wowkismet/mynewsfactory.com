# Architecture Audit

Audit date: 2026-09-20 · Commit audited: `448c537` · Auditor: engineering

This document records what the repository **actually contains today**, measured
rather than assumed. It is the baseline for `IMPLEMENTATION_PLAN.md`. Where the
MY NEWS FACTORY 4.0 specification describes a capability that does not exist
here, this document says so plainly rather than describing the intent as though
it were built.

---

## 1. Headline finding

The repository is a **static editorial front end**, roughly 1,300 lines of
application code. The specification describes a multi-sided platform with
money movement, identity documents, a rewards economy, an advertising
marketplace and an AI editorial pipeline.

Measured against the specification's own Definition of Done (§80 — UI + API +
database + validation + authorization + business logic + error handling + audit
+ security + tests + analytics + documentation), **no feature in the
specification is complete.** One is genuinely done to a narrower standard: the
public reading experience, as a front end with no backend.

This is not a criticism of what exists. What exists is clean, typed, and
correctly deployed. It is approximately 2% of the described product, and the
remaining 98% is the part that handles money and identity.

---

## 2. Current stack

| Layer | Technology | Version | Notes |
| --- | --- | --- | --- |
| Framework | Next.js (App Router) | 16.3.5 | React Server Components by default |
| UI | React | 19.3.0 | One client component (`Clock.tsx`) |
| Language | TypeScript | 5.7.3 | `strict: true`, `noUncheckedIndexedAccess: true` |
| Styling | Hand-authored CSS | — | Design tokens in `globals.css`; no Tailwind |
| Runtime | Node.js | 22 (alpine) | `output: 'standalone'` |
| Container | Docker + Compose | — | Published on host loopback `127.0.0.1:3100` |
| Proxy | nginx | host-level | TLS via certbot / Let's Encrypt |
| Database | **none** | — | Content is in-process arrays |
| ORM | **none** | — | |
| Auth | **none** | — | |
| API | **none** | — | No route handlers exist |
| Cache / queue / search | **none** | — | |
| Object storage | **none** | — | |
| Tests | **none** | — | No test runner, no test files |
| CI/CD | **none** | — | Workflow existed and was removed at `1c77b31` |

Runtime dependency count: **3** (`next`, `react`, `react-dom`). `npm audit`
reports 0 vulnerabilities.

---

## 3. Repository map

```
Dockerfile                  multi-stage build, non-root runtime user, healthcheck
docker-compose.yml          loopback-only publish, cap_drop ALL, no-new-privileges
deploy/
  install.sh                non-container installer (superseded, retained)
  mynewsfactory.service     systemd unit (superseded, retained)
  nginx-mynewsfactory.conf  vhost template (HTTP only; certbot adds 443)
  fix-domain.sh             repairs the live vhost upstream port
  whoserves.sh              read-only diagnostic for port 443 ownership
web/
  next.config.mjs           security headers, standalone output
  src/app/                  4 routes + not-found
  src/components/           Chrome, Panels, Story, Clock
  src/lib/content.ts        in-memory editorial data + async accessors
  src/lib/pricing.ts        central pricing configuration
  src/lib/types.ts          domain types
docs/                       this audit and its companions
```

29 tracked files. 2,331 total lines, of which `package-lock.json` is 1,016.

---

## 4. What is implemented

### 4.1 Public portal — working

Four routes, 28 statically generated pages:

| Route | Rendering | Content |
| --- | --- | --- |
| `/` | Static | Hero, Live World panel, Live Now rail, Top News, services, My City |
| `/news/[slug]` | SSG, 9 paths | Article with standfirst, body, reporter, related stories |
| `/category/[slug]` | SSG, 12 paths | Section listing |
| `/city/[slug]` | SSG, 4 paths | City newsroom |

Verified this audit: build succeeds, typecheck passes, all routes return 200,
unknown paths return 404.

### 4.2 Security headers — working

Set in `next.config.mjs` and verified on live responses:

- `Content-Security-Policy` (see §7.1 for a known weakness)
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
- `poweredByHeader: false`

### 4.3 Pricing indirection — partially implemented

`src/lib/pricing.ts` is the single source for every displayed price. No
component contains a currency figure. This satisfies the *shape* of §61 (no
hard-coded business rules at call sites) but not its substance: the values are
a compile-time constant, not a versioned table with effective dates, country
scoping or an admin surface.

Current values: training ₹2,500 · referral 20% · advertising ₹50–₹5,000/day ·
survey ₹50–₹500 per valid response · interview and success story ₹10,000.

### 4.4 Content accessors — deliberate seam

`src/lib/content.ts` exposes 12 `async` functions returning promises over
in-memory arrays (12 categories, 4 cities, 5 reporters, 9 articles). The async
signature exists so that replacing the module with database queries does not
change any call site. This is the correct seam and should be preserved.

### 4.5 Deployment — working, with one open defect

The portal builds and runs as a Docker container on the VPS, published only on
`127.0.0.1:3100`, proxied by host nginx with certbot TLS. The host is shared
with rareminting.com, which owns port 3000.

**Open defect:** `www.mynewsfactory.com` serves the portal correctly; the apex
`mynewsfactory.com` still serves rareminting. Diagnosis in progress — the
symptom (exact `server_name` match losing to another block) indicates a second
server block claiming the apex name outside `sites-enabled/`. Tracked in
`DECISIONS.md` D-009.

---

## 5. What is not implemented

Everything below is specified and absent. No partial implementation exists for
any of it — there is no stub, no table, no route handler.

| Specification area | § | State |
| --- | --- | --- |
| Authentication (password, OTP, MFA, sessions) | 7 | Absent |
| RBAC — 22 roles, scopes, ownership checks | 6 | Absent |
| PostgreSQL schema (~90 tables) | 10 | Absent |
| REST API `/api/v1` | 68 | Absent |
| Financial ledger | 11 | Absent |
| Revenue allocation engine | 12 | Absent |
| Multi-currency | 13 | Absent |
| Payment provider abstraction | 14 | Absent |
| Reporter training, certificates, KYC | 15 | Absent |
| Referrals and anti-abuse | 16 | Absent |
| Advertising marketplace and rotation | 17–19 | Absent |
| Polls, surveys, video surveys | 20–21 | Absent |
| Reward coins and reward ledger | 22 | Absent |
| Fraud engine | 23 | Absent |
| Newsroom workflow and versioning | 24, 59 | Absent |
| AI news pipeline | 25–29 | Absent |
| Assignment marketplace | 30 | Absent |
| Professional services (interview/story/biography) | 31 | Absent |
| Business profiles | 32 | Absent |
| Country configuration engine | 34 | Absent |
| i18n | 35 | Absent — all strings are literals in components |
| Analytics events | 37 | Absent |
| Admin command center | 38–40 | Absent |
| Notification engine | 41 | Absent |
| Mobile app | 42 | Absent |
| SEO structured data | 44 | Partial — metadata only, no JSON-LD or sitemaps |
| Search | 46 | Absent |
| Observability | 47 | Absent |
| Backups / DR | 48 | Absent |
| CI/CD | 49 | Absent — removed at `1c77b31` |
| Tests of any kind | 52–53 | Absent |
| Feature flags | 62 | Absent |
| Design system components | 85 | Absent — page-specific CSS classes only |
| Accessibility programme | 86 | Unmeasured |
| PWA | 88 | Absent |

---

## 6. Existing database schema

None. There is no database, no migration directory and no ORM.
`web/.env.example` contains a commented-out `DATABASE_URL` as a placeholder.

---

## 7. Security risks

Ordered by severity as it applies **today**, to the code that actually runs.

### 7.1 CSP allows inline styles — Medium

`style-src 'self' 'unsafe-inline'`. Required today because Next.js injects
inline `<style>` elements. Combined with `script-src 'self'` (no
`unsafe-inline`), this does not permit script execution, so it is not
immediately exploitable — but it weakens the defence and should move to a
nonce-based policy before any user-generated content is rendered.

**This becomes critical the moment comments, citizen submissions or advertiser
creatives are accepted.** It must be fixed before Phase 3, not after.

### 7.2 No authenticated surface to attack — informational

The application has no login, no forms, no writes and no API. The current
attack surface is a read-only static site. Most of the specification's security
requirements (§§6–9, 53) cannot be violated because the functionality does not
exist. This is the one genuine advantage of the current state: the security
architecture can be designed before there is anything to retrofit.

### 7.3 Deployment scripts run as root and edit nginx — Medium (operational)

`deploy/fix-domain.sh` modifies live nginx configuration on a host shared with
another production site. Mitigations in place: whole-config backup before any
change, block-scoped edits that exclude rareminting, `nginx -t` validation with
automatic restore on failure, no process termination. The residual risk is that
a scripted edit is still an unreviewed change to a shared production host.

**History note:** an earlier iteration of this deployment work took
rareminting.com offline by terminating a process on port 3000 that belonged to
it. The guards above exist because of that incident. They should not be
removed.

### 7.4 Single host, no backups — High (operational)

One VPS runs both sites. There is no database to lose today, but there is also
no documented backup, no restore test and no recovery procedure. §48 requires
all three. The risk rises sharply the moment a database exists.

### 7.5 No CI, so nothing is verified before deploy — Medium

Deploys are manual console operations. Nothing enforces lint, typecheck, build
or test before code reaches the server. §49 requires a pipeline; §78 makes a
working CI/CD a production-readiness gate.

### 7.6 No dependency or container scanning — Medium

`npm audit` is clean today and was run manually. Nothing runs it automatically,
and nothing scans the container image.

### 7.7 Secrets — currently acceptable

No secrets exist in the repository. `.env.example` is the only env file
committed and contains no values. `.gitignore` excludes `.env*`. This is
correct and must stay correct: §50 and §51 prohibit committing private keys,
`.env` files and production credentials.

**Outstanding action from session history:** an RSA-2048 private key was
transmitted through a chat channel during deployment setup. It should be
rotated, and the corresponding public key removed from the server's
`authorized_keys`, regardless of whether it was ever used.

---

## 8. Performance risks

Low today and worth stating precisely: 28 pages are generated at build time and
served as static files behind nginx. There is no database, so there are no
queries to optimise and no N+1 problems to find.

The risks are all forward-looking:

- `getArticles()` returns every article. Against a table this becomes an
  unbounded scan. Cursor pagination is required before the data layer lands
  (§45).
- No caching layer, so every dynamic route added later hits the origin.
- No CDN in front of media; §74 requires one before video exists.
- The single container has no horizontal scaling story. Fine for launch;
  §73 requires the architecture not to *prevent* scaling, which it currently
  does not.

---

## 9. Technical debt and duplication

Modest, and worth clearing early while it is cheap:

1. **Two deployment paths.** `deploy/install.sh` + `mynewsfactory.service`
   (systemd, non-container) and `Dockerfile` + `docker-compose.yml` (container).
   The container is in use. The systemd path is retained but unused, and an old
   `mynewsfactory` systemd unit may still exist on the server. Keeping two
   deployment stories invites deploying the wrong one.
2. **`deploy/nginx-mynewsfactory.conf` is stale.** It is HTTP-only; the live
   config has been modified in place by certbot and by `fix-domain.sh`. The
   repository copy no longer reflects the server. Configuration that drifts
   from its source of truth is how the port-3000 defect survived three rounds
   of fixes.
3. **No linting.** `next lint` is declared in `package.json` but no ESLint
   configuration exists, so it is not actually enforcing anything.
4. **Design tokens are not a design system.** `globals.css` holds a coherent
   token set, but components consume bespoke class names. §85 requires
   reusable primitives; building them before the admin and reporter surfaces
   exist is far cheaper than retrofitting.

---

## 10. Missing requirements that change the architecture

Three decisions cannot be deferred, because everything else is shaped by them.

1. **Money representation.** The ledger (§11) and multi-currency (§13)
   requirements mean amounts must be integer minor units with an explicit
   currency, never floating point, from the first migration. Retrofitting this
   after transactions exist means a data migration over financial records.
2. **Configuration versioning.** §61 requires effective-dated configuration.
   A historical transaction must be reproducible against the rates in force
   when it happened. Adding effective dates later invalidates every allocation
   already computed.
3. **Audit from the first privileged action.** §60 requires immutable audit
   events. Audit added retroactively has a hole exactly where the early,
   least-reviewed code ran.

---

## 11. Recommended migration plan

Summarised here; the phased detail is in `IMPLEMENTATION_PLAN.md`.

1. **Do not rewrite the front end.** It is correct, typed, accessible to
   extend, and the content seam is already in the right place.
2. **Establish the engineering floor first** — lint, tests, CI. Without it,
   every subsequent phase ships unverified. This is the cheapest work in the
   entire plan and it gates everything.
3. **Then the data layer** — PostgreSQL, migrations, and swapping
   `content.ts` for real queries behind the existing accessor signatures.
4. **Then identity** — authentication and RBAC, before any surface that
   writes.
5. **Only then money.** Ledger, revenue engine and payments, behind the
   §78 security acceptance gate and an independent review.

The specification's own §97 warns against deploying enterprise technology on
day one. Redis, OpenSearch, Kafka, a queue cluster and a microservice split are
all deferred until a measured need exists. See `DECISIONS.md` D-002.
