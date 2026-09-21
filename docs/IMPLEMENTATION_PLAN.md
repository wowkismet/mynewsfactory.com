# Implementation Plan

Phased execution plan for MY NEWS FACTORY 4.0, from the baseline recorded in
`ARCHITECTURE_AUDIT.md` (commit `448c537`).

The phase order follows §95, with one addition: **Phase 0**, an engineering
floor that must exist before anything else is built. §79 requires each phase to
be inspected, planned, implemented, tested, security-reviewed, migrated and
documented before the next begins. Without lint, tests and CI, "tested" has no
mechanism, so Phase 0 comes first.

**A phase is complete only when it meets §80's Definition of Done** — UI, API,
database, validation, authorization, business logic, error handling, audit,
security, tests, analytics and documentation, as applicable. A page that exists
is not a feature.

---

## Phase 0 — Engineering floor

**Why first.** Every later phase depends on being able to verify a change. This
is the cheapest work in the plan and it gates all of it.

| Deliverable | § |
| --- | --- |
| ESLint + Prettier with strict rules, wired to `npm run lint` | 98 |
| Test runner and the first real tests (pricing maths, content accessors, route rendering) | 52 |
| CI on every pull request: install → lint → typecheck → test → build → `npm audit` | 49 |
| `docs/TESTING.md` — the test strategy | 52 |
| Dependency and container scanning in CI | 8 |

**Explicitly out of scope:** deployment automation. CI holds no secrets (D-008).

**Done when:** a pull request cannot merge without lint, typecheck, tests and
build passing, and the pipeline runs without any repository secret.

---

## Phase 1 — Foundation

Corresponds to §95 Phase 1. Ends with a real newsroom serving real content.

### 1a. Data layer
- PostgreSQL, parameterised SQL (D-011), migration pipeline with rollback (§83)
- Core schema: `users`, `profiles`, `countries`, `states`, `cities`,
  `languages`, `currencies`, `categories`, `news`, `news_versions`,
  `news_media`, `reporters`
- Money columns as integer minor units from the first migration (D-003)
- `content.ts` replaced by queries behind the **existing accessor signatures**
- Cursor pagination on every list query (§45) — `getArticles()` returning
  everything does not survive contact with a real table
- Seed script for development and test only; production fails to start without
  real content (D-010)

### 1b. Identity
- Authentication: Argon2id password hashing, email verification, session
  management, refresh-token rotation, device tracking (§7)
- MFA with TOTP and recovery codes; **mandatory** for all admin roles
- Rate limiting and brute-force protection on every auth endpoint (§71)
- RBAC: the 22 roles of §6, with permission scopes and resource-level
  ownership checks enforced in one layer, not per-handler
- Audit logging from the first privileged action (§60) — retrofitted audit has
  a hole exactly where the earliest code ran

### 1c. API
- `/api/v1` with schema validation on every input, typed responses, consistent
  error envelopes carrying `requestId` (§70), versioning and rate limits
- OpenAPI generated from the implementation, not maintained beside it (§69)

### 1d. Editorial
- Content state machine: `DRAFT → SUBMITTED → AI_REVIEW → EDITOR_REVIEW →
  FACT_CHECK → APPROVED → SCHEDULED → PUBLISHED`, plus
  `CORRECTION_REQUIRED / UNPUBLISHED / REJECTED` (§59)
- Versioning with preserved history; corrections never destroy the original
- Editor queues; admin shell with KPI cards and pending-approval queues (§38)

### 1e. Platform hygiene
- Structured logging with correlation IDs (§47)
- Error tracking, uptime and database monitoring
- Database backups, **a tested restore**, and `docs/DISASTER_RECOVERY.md` (§48)
- A staging environment — required by the §78 gate and absent today
- Design system primitives (§85) before the admin and reporter surfaces
  multiply the cost of not having them
- i18n scaffolding with translation keys (§35); English first, but no literal
  UI strings

### Security review for Phase 1

Executable tests for the §53 cases that apply: cross-user profile access,
role escalation, parameter tampering, session fixation, rate-limit bypass.

The cases reachable without an HTTP surface are done and passing in
`db/identity.test.ts`: role escalation (a reader, a reporter and an
administrator each denied what they should not hold), scope escape (a
city-scoped grant refused outside its city *and* refused when no scope is
supplied), token replay, refresh-token reuse, cross-account recovery-code use,
and the audit log's immutability. The remainder — parameter tampering, session
fixation, IDOR over real endpoints — need Phase 1c and are not yet testable.

**Done when:** a reporter can be created, an editor can move a story through
the workflow to publication, a reader can read it, every step is audited, and
the §53 tests pass in CI.

---

## Phase 2 — Reporter economy

Training, certificates, KYC, reporter cards, assignments, wallet, commissions,
referrals (§§15, 16, 30).

**Gate:** KYC storage requires T-02's mitigations implemented and tested —
private storage, signed URLs, encryption at rest, `KYC_ADMIN`-only access,
retention limits. Not designed: implemented and tested.

**Gate:** referrals require T-01's anti-abuse controls before any referral
reward is payable. §16's list — self-referral prevention, duplicate-account
detection, attribution windows, qualification events, reversal — is the
minimum.

Wallets are ledger projections (D-004), not mutable balances.

---

## Phase 3 — Advertising

Advertisers, campaigns, creatives, slots, rotation engine, pacing, frequency
caps, targeting, analytics, billing (§§17–19).

**Prerequisite:** the CSP must move to a nonce-based policy before advertiser
creatives are rendered (audit §7.1). Third-party creative on a page with
`unsafe-inline` styles is a different risk class from a static site.

Advertiser analytics are aggregated and anonymised. Raw IP addresses are never
exposed to advertisers (§19, §57).

---

## Phase 4 — Research

Polls, surveys, video surveys, reward coins, response validation (§§20–23).

**This phase is where the platform starts paying people**, so T-01 is the
dominant concern. Build the fraud engine *with* the survey engine, not after
it. Rewards enter `PENDING` and require validation to become `AVAILABLE`.

No client-side code ever awards a coin (§22).

---

## Phase 5 — Professional services

Interviews, success stories, biographies, business stories, assignments
(§31). Priced through the configuration engine, never as constants (D-005).

---

## Phase 6 — Value engine

Reader rewards, reporter earnings, company revenue, the revenue allocation
engine, multi-currency (§§12, 13).

**Gate D-006 applies in full.** Payments go live only after an independent
security and financial review, with the §78 acceptance gate met completely.
Building and testing against a sandbox provider is unblocked; taking real money
is a separate, explicitly authorised decision.

Every allocation produces an immutable record referencing the configuration
version it was computed against.

---

## Phase 7 — AI news factory

Ingestion, normalisation, deduplication, clustering, translation, entity
extraction, summarisation, source attribution (§§25–29).

D-007 governs: AI drafts and recommends; humans publish anything high-risk.
T-07's prompt-injection mitigations are a build requirement, not a hardening
pass. Ingested content is data, never instruction.

---

## Phase 8 — Global

Country modules, additional languages and currencies, global reporters,
advertisers, research and assignments (§34).

The architecture must be global from Phase 1 (no hard-coded India, no hard-coded
INR, no literal UI strings). Phase 8 is *activation*, not retrofit. If Phase 1
hard-codes a country, this phase becomes a rewrite.

---

## Sequencing constraints

These cannot be reordered without rework:

1. **Phase 0 before everything.** Otherwise no phase can satisfy §79's "test"
   step.
2. **Money representation before any transaction** (D-003). Changing it later
   is a migration over financial records.
3. **Configuration versioning before any priced product** (D-005). Adding
   effective dates later invalidates every allocation already computed.
4. **Audit before the first privileged action** (§60).
5. **Authentication and RBAC before any write surface.** Adding authorization
   to existing endpoints reliably misses one.
6. **Fraud engine with the reward engine, not after** (T-01).
7. **Nonce-based CSP before third-party or user-generated content renders.**

---

## What is deliberately deferred

Per §97 and D-002, none of the following is built until a measured need exists:

| Technology | Deferred until |
| --- | --- |
| Redis | Session scale, cross-instance rate limiting, or a job queue is needed |
| BullMQ | Background work exists that cannot run in-process |
| OpenSearch | PostgreSQL full-text search is demonstrably insufficient |
| Kafka | Not planned. Revisit only with evidence Redis-based queuing cannot cope |
| Microservice split | A module has an operational reason to scale or deploy separately |
| Mobile app | The web experience is complete and stable |
| PWA | Measured demand from mobile reporters |

Deferring is not declining. Module boundaries are kept real so extraction is
mechanical when the need arrives.

---

## Current status

| Phase | Status |
| --- | --- |
| Phase 0 | Complete — lint, CI green |
| Phase 1a — data layer | Schema, migrations, repository and seed done and tested; the portal still reads fixtures |
| Phase 1b — identity | Credentials, sessions, MFA, RBAC and audit done and tested; no HTTP surface yet |
| Phase 1c — API | Not started. This is what makes 1a and 1b reachable |
| Phase 1d–1e | Not started |
| Phases 2–8 | Not started |

202 tests, of which 91 run against real PostgreSQL.

The public portal from the pre-phase work (4 routes, 28 static pages) is live
and stays; it becomes the reader surface of Phase 1 once the data layer
replaces its fixtures.

**Deployment.** The portal is live over HTTPS on both `mynewsfactory.com` and
`www.mynewsfactory.com`, running as a container on `127.0.0.1:3100` behind
nginx, on a host shared with rareminting.com. The routing defect tracked as
D-009 is closed.

Deploys are manual console operations. §49 wants a pipeline; D-008 explains why
verification runs in CI while deployment does not.
