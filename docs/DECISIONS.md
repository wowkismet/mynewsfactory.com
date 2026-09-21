# Decisions

Engineering decisions that depart from a literal reading of the MY NEWS FACTORY
4.0 specification, or that resolve an ambiguity in it. Required by §101.

Each entry records the decision, why, what else was considered, and what it
costs. Decisions are append-only: superseding one adds a new entry that
references it rather than editing history.

---

## D-001 — Keep the existing front end; do not rewrite

**Date:** 2026-09-20

**Decision.** The Next.js 16 / React 19 / TypeScript portal stays. No migration
to another framework, no restructure of `web/src`.

**Reason.** §1.10 and §84 both forbid rewriting working functionality by
preference. The code is strict-typed, has zero `dangerouslySetInnerHTML`, no
`any` in application logic, passes `npm audit` clean, and its content accessors
are already async — the seam a database needs. Rewriting would cost weeks and
buy nothing.

**Alternatives.** A monorepo restructure to `apps/web` per §4 — deferred until
a second application (admin or API) actually exists. Moving to Tailwind —
rejected; the hand-authored token system in `globals.css` is coherent and
carries the approved visual design.

**Impact.** Phase 1 begins from a working base. The `apps/` split happens when
the API service is created, not before.

---

## D-002 — Modular monolith first; defer Redis, OpenSearch, Kafka and the service split

**Date:** 2026-09-20

**Decision.** Build one deployable application with strict internal module
boundaries. PostgreSQL is the only datastore at the start. Add Redis when a
measured need appears (sessions at scale, rate limiting across instances, a job
queue). Add OpenSearch when PostgreSQL full-text search is demonstrably
insufficient. Do not adopt Kafka.

**Reason.** §97 states this explicitly: prefer the simplest production-grade
solution, use Redis/BullMQ before Kafka, use PostgreSQL search before
OpenSearch, use a modular monolith initially. The platform currently has no
users. Operating six services would add failure modes without removing any.

**Alternatives.** The full `services/` split in §4 — correct eventually, wrong
now. The decision is *when*, not *whether*.

**Impact.** Module boundaries must be real (no cross-module database access) so
that extraction later is mechanical. Enforced by directory structure and lint
rules, not convention.

---

## D-003 — Money is integer minor units with an explicit currency

**Date:** 2026-09-20

**Decision.** Every monetary amount is stored as a signed 64-bit integer in the
currency's minor unit (paise, cents), alongside an ISO 4217 currency code.
Floating point is prohibited for money anywhere in the system — database,
API, business logic and serialisation.

**Reason.** §11 requires an auditable ledger and §13 requires multi-currency
with historical accuracy. Floating point cannot represent decimal currency
exactly; the errors accumulate in exactly the place that is hardest to correct.

**Alternatives.** PostgreSQL `NUMERIC` — exact, but invites JavaScript `number`
conversion at the boundary, which reintroduces the problem silently. Integer
minor units make the boundary explicit and are the standard payment-provider
representation.

**Impact.** A formatting layer is required at every display point. Zero-decimal
currencies (JPY) need per-currency exponent data, not a hard-coded ×100.

---

## D-004 — Double-entry ledger; financial records are never mutated

**Date:** 2026-09-20

**Decision.** All money movement is recorded as balanced double-entry journal
entries. Balances are derived from entries, never stored as an authoritative
mutable field. Corrections are new reversing entries. No `UPDATE` and no
`DELETE` on ledger tables; enforced at the database level, not only in
application code.

**Reason.** §11 is explicit that `wallet.balance = wallet.balance + 500` is
prohibited and that financial records must not be deleted.

**Alternatives.** A mutable balance with a separate audit log — the audit log
then disagrees with the balance the first time a write fails midway, and there
is no way to tell which is right.

**Impact.** Reads need a cached balance projection for performance, rebuildable
from entries at any time. Any disagreement between projection and ledger is a
P1 incident, and reconciliation must be automated (§39).

---

## D-005 — Configuration is versioned and effective-dated; nothing financial is a constant

**Date:** 2026-09-20

**Decision.** Prices, commission rates, reward rates, referral percentages, tax
rules and country rules live in versioned configuration rows with an
`effective_from` timestamp. A transaction records the configuration version it
was computed against. No financial rate is ever a code constant.

**Reason.** §61 requires effective dates and versioned configuration; §12
requires configurable revenue rules. A historical allocation must remain
reproducible after rates change — otherwise every past transaction silently
re-values whenever an admin edits a rate.

**Alternatives.** Current-value configuration with an audit trail of edits —
insufficient: reproducing a past calculation would require replaying the edit
log, which is error-prone and slow.

**Impact.** `web/src/lib/pricing.ts` is a temporary stand-in. Its shape already
anticipates this; its values do not. Replacing it is a Phase 2 task, and the
call-site signatures do not change.

---

## D-006 — No payment processing, KYC storage or fund custody until an independent audit

**Date:** 2026-09-20

**Decision.** Build the ledger, revenue engine and provider abstraction as
designed and fully tested. Do **not** connect a live payment provider, store
identity documents, or hold user funds until an independent security and
financial review has passed, and until the §78 acceptance gate is met in full.

**Reason.** §78 defines the gate. Handling other people's money and identity
documents carries legal obligations that no amount of internal review
discharges. The failure mode is not a bug; it is a regulatory event affecting
real people.

**Alternatives.** Ship payments behind a feature flag and audit afterwards —
rejected: the flag protects the code path, not the users whose data has already
been collected.

**Impact.** Phases 2–6 are buildable and testable end to end against a sandbox
provider. Going live on payments is an explicit, separately authorised gate.
This is stated now so it does not arrive as a surprise later.

---

## D-007 — AI may draft and recommend; it may not publish high-risk content

**Date:** 2026-09-20

**Decision.** The AI pipeline (§25) may ingest, cluster, translate, summarise
and recommend. Publication of any story touching criminal allegations, deaths,
health claims, financial claims, political allegations, elections, conflict or
public safety requires a named human editor's approval, recorded in the audit
log. Model confidence is never sufficient authority to publish.

**Reason.** §26 and §56 require this. A confident model is not a correct model,
and the harm from an incorrect criminal allegation is not recoverable by
retraction.

**Alternatives.** Confidence thresholds for auto-publication — rejected
explicitly by §26.

**Impact.** Editorial throughput on high-risk categories is bounded by human
review capacity. That is the intended trade.

---

## D-008 — CI runs without deployment secrets

**Date:** 2026-09-20

**Decision.** The CI pipeline runs install, lint, typecheck, test and build. It
holds no SSH key and performs no deployment. Deployment stays a separate,
explicitly authorised pipeline to be designed when a staging environment
exists.

**Reason.** §49 requires verification on every pull request; §50 requires
private keys to exist only in secure CI secrets. A previous deploy workflow in
this repository failed six consecutive runs because the SSH key was placed as a
GitHub *Environment* name and later as an account-level key — neither is
visible to a workflow — and was removed at `1c77b31`. Verification is valuable
on its own and needs no credentials, so it should not be blocked on solving
credential delivery.

**Alternatives.** Restoring the combined verify-and-deploy workflow — couples
a pipeline that needs no secrets to one that does, and reproduces the failure
that caused its removal.

**Impact.** Merges are verified. Deployment remains manual until a staging
environment and a correctly scoped repository secret exist.

---

## D-009 — Live nginx configuration is authoritative; the repository copy is not

**Date:** 2026-09-20

**Decision.** Treat `deploy/nginx-mynewsfactory.conf` as a template only.
Changes to live routing are made by reviewed scripts that read the current
config, validate with `nginx -t`, and restore a backup on failure. The
long-term fix is to render the vhost from the repository and reload it, so
drift cannot recur.

**Reason.** Configuration drift caused a three-round misdiagnosis: the
repository moved the portal to port 3100, the live vhost still proxied to 3000
(rareminting's app), and the domain served the wrong site. The repository copy
was never the thing being served.

**Resolved 2026-09-20.** Both `mynewsfactory.com` and `www.mynewsfactory.com`
serve the portal. Mapping every `server_name` to its file showed no competing
claim: `sites-enabled/mynewsfactory.com` holds both names and `sites-enabled/
rareminting` holds only its own. The apex was fixed by `fix-domain.sh`, which
corrected the vhost's upstream from port 3000 (rareminting's app) to 3100 and
added a 443 `default_server`; what remained missing afterwards was a container
listening on 3100, supplied by the first successful container deploy.

The wrong diagnosis cost three rounds. The symptom — one name working and
another failing on the same `server_name` line — was read as a competing
server block, when it was a vhost pointing at an upstream that was not
running. The lesson stands: read the live configuration before theorising
about it.

**Impact.** Until the vhost is rendered from source, every routing change needs
a read-verify-write cycle against the live host, and the repository must not be
trusted to describe production.

---

## D-010 — Seed content is labelled and confined to development

**Date:** 2026-09-20

**Decision.** The 9 articles, 5 reporters, 12 categories and 4 cities in
`content.ts` are demonstration fixtures. When the data layer lands they move to
a seed script that runs only in development and test. Production must fail to
start rather than silently serve fixtures.

**Reason.** §81 prohibits production depending on mock data and requires
demo content to be clearly labelled.

**Alternatives.** Seeding production with sample articles at launch — rejected:
a news platform serving invented articles under real reporter names is an
editorial integrity failure, not a placeholder.

**Impact.** The launch checklist must include real editorial content. An empty
newsroom is a better failure than a fictional one.

---

## D-011 — Parameterised SQL over an ORM, with a real PostgreSQL in tests

**Date:** 2026-09-20

**Decision.** The data layer is hand-written parameterised SQL behind a
two-method interface (`query`, plus a transaction helper), not Prisma or
another ORM. The same interface is satisfied by node-postgres in production and
by PGlite — PostgreSQL compiled to WebAssembly — in tests.

**Reason.** §3 says to prefer Prisma "if the existing repository does not
constrain the architecture", and §97 says to prefer the simplest
production-grade solution. Three things decided it:

- **Injection is prevented by construction.** Every value is a bound
  parameter. There is no query-builder escape hatch where a raw fragment can be
  concatenated, and no place where a template literal silently becomes SQL.
- **Tests run against real PostgreSQL.** `CHECK` constraints, enum types,
  `BEFORE UPDATE` triggers, row-value comparisons and partial indexes all
  behave exactly as they will in production, with no mock and no service
  container in CI. The schema's guarantees are tested as guarantees.
- **The schema is the source of truth.** Append-only history and the
  published-state invariant are enforced by triggers and constraints that no
  application bug, ad-hoc script or future ORM can bypass. An ORM's model
  definitions would compete with the schema for that role.

**Alternatives.** Prisma — mature, good types, and the specification's first
suggestion. Rejected for now because its migration workflow expects a running
database, its generated client would duplicate the schema in a second place,
and raw SQL for the constraint and trigger logic would be needed regardless.
Kysely — typed query building without codegen, a reasonable middle ground;
rejected as an abstraction that is not yet earning its dependency.

**Impact.** Row types are the caller's assertion about a SQL string's columns,
which no type system can verify. That assertion is explicit and localised to
`repository.ts`, and the repository tests exercise every query against a real
database, so a mismatch fails a test rather than reaching production. If the
schema grows past the point where hand-written SQL is the bottleneck, this
decision is revisited — the interface is narrow enough to swap.

---

## D-012 — Argon2id through a prebuilt binary, not a compiled dependency

**Date:** 2026-09-21

**Decision.** Passwords are hashed with Argon2id via `@node-rs/argon2`, at
OWASP's 2024 parameters (19 MiB, two iterations, one lane).

**Reason.** §7 requires secure password hashing, and Argon2id is the current
recommendation: memory hardness is what makes a GPU or ASIC attack cost what it
should. `@node-rs/argon2` ships prebuilt binaries including linux-x64-musl, so
the Alpine runtime image needs no compiler and the build stays reproducible.
Measured at about 70 ms per hash on the deployment host, which is the right
side of the usability-versus-cost line.

**Alternatives.** The `argon2` package compiles through node-gyp, adding a
toolchain to the image for the same algorithm. `crypto.scrypt` is built in and
needs no dependency at all — genuinely tempting given T-10, and the fallback if
the native module ever becomes a problem — but it is OWASP's second choice, and
password hashing is the wrong place to take second choice to save a dependency.

**Impact.** One native dependency, verified by CI's container job on the image
that actually ships. The stored PHC string carries its own parameters, so
raising the cost later needs no migration.

---

## D-013 — Tokens stored as digests; refresh reuse revokes the session

**Date:** 2026-09-21

**Decision.** Session, refresh, verification and reset tokens are stored as
SHA-256 digests. Refresh tokens are single use, and presenting a consumed one
revokes the entire session rather than refusing the single token.

**Reason.** A token is a bearer credential: whoever holds it is the account. If
the table stores them, a read of the table is a takeover of every live session.
A plain digest is right here because the input already has 256 bits of entropy
— there is nothing to brute-force, and an unsalted digest is what makes lookup
by token possible.

Reuse detection is the part worth arguing for. A consumed refresh token being
presented again means it leaked; there is no way to tell whether the legitimate
client replayed it or an attacker captured it. Refusing just that token leaves
a live session the attacker may also hold. Revoking the session costs a
legitimate user one sign-in and costs an attacker everything.

**Alternatives.** Stateless JWTs with short expiry — no revocation, which makes
"sign out everywhere" and "revoke this device" impossible to honour, both of
which §7 requires. Storing tokens encrypted rather than hashed — reversible by
design, which is the property being avoided.

**Impact.** Every session check is a database read; there is no offline
validation. That is the cost of being able to revoke, and it is worth paying.
A partial unique index enforces one live refresh token per session even if the
rotation code is wrong.

---

## D-014 — TOTP implemented here, verified against the RFC's own vectors

**Date:** 2026-09-21

**Decision.** RFC 6238 TOTP is implemented in `auth/totp.ts` rather than taken
as a dependency.

**Reason.** The algorithm is about forty lines of HMAC and arithmetic, and the
RFC publishes test vectors that prove an implementation correct. All eighteen
run as tests, for SHA-1, SHA-256 and SHA-512. A second-factor check is a poor
place to inherit an unaudited package: it is small enough to read, and its
correctness is provable rather than assumed.

Writing it also made three properties explicit that a library would have
decided silently: verification evaluates every candidate step before returning
so timing reveals nothing, comparison is constant-time, and the accepted step
is recorded so a code cannot be replayed inside its own validity window.

**Alternatives.** `otplib` and `speakeasy` are widely used and would have
worked. Rejected because the reason to take a dependency — that the problem is
large or subtle enough that someone else's version is safer — does not apply to
forty lines with published vectors.

**Impact.** This code is ours to maintain. The RFC has not changed since 2011,
and the vectors will fail loudly if it ever does.

---

## D-015 — Low-entropy identifiers are keyed hashes, never plaintext

**Date:** 2026-09-21

**Decision.** IP addresses and the email addresses in the attempt log are
stored as HMAC-SHA256 digests under a key held in the environment. No table
holds a plaintext address.

**Reason.** §57 requires data minimisation and prohibits exposing raw addresses
(§19). The operational need is real — rate limiting, lockout, noticing a
session that moved networks — but every one of those works on equality, which a
keyed hash preserves.

The key matters. An unkeyed digest of an IPv4 address is reversible in seconds:
there are only four billion of them. An unkeyed digest of an email address
falls to a wordlist. The key means the table alone reveals nothing.

**Alternatives.** Storing addresses plainly with short retention — simpler, and
still a list of who signed in from where for as long as it exists. Truncating
addresses — loses the precision rate limiting needs while still being partially
identifying.

**Impact.** An address cannot be recovered from the database, including by us,
including under a lawful request. Rotating the key makes existing hashes
unlinkable: a privacy improvement and an operational inconvenience, so it is
done deliberately rather than routinely. Geolocation, if ever needed, must
happen at ingest and store a region, never the address.

