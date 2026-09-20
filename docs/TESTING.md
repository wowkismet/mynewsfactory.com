# Testing Strategy

Required by §52. Describes what is tested today and what each later phase must
add before it can be called complete under §80.

---

## Principles

1. **A test asserts a contract, not an implementation.** The content tests are
   written against the accessor signatures, so they keep their value when
   fixtures become database queries in Phase 1.
2. **Security cases are executable tests, not a checklist.** §53 lists
   twenty-six attacks. Each becomes a test that fails if the attack succeeds.
3. **A failing test is never silenced.** If a test and the code disagree, one
   of them is wrong and the disagreement gets resolved, not suppressed.
4. **Financial logic is tested to the rupee.** Rounding, currency conversion
   and allocation get exact-value assertions, never approximate ones.

---

## Current coverage

| Suite | File | Tests | What it protects |
| --- | --- | --- | --- |
| Pricing | `web/src/lib/pricing.test.ts` | 11 | Amounts whole and non-negative, bands ordered, referral maths exact, currency and locale well-formed, formatting correct |
| Content | `web/src/lib/content.test.ts` | 23 | Referential integrity, slug uniqueness and URL safety, unknown-key lookups return `undefined` rather than throwing, filters do not leak across categories or cities, `getRelated` excludes its own article and deduplicates, bodies contain no markup |

34 tests. Runner: Vitest 5, Node environment. `npm test` in `web/`.

Two of these already earn their place:

- **Path traversal on a slug lookup.** `getArticle('../../../etc/passwd')`
  must return `undefined`. Trivial today because lookups are array scans; it
  stops being trivial when the accessor builds a query or reads a file.
- **No markup in article bodies.** Bodies render as text nodes. A fixture
  containing a tag would be a standing invitation to switch to
  `dangerouslySetInnerHTML` later. The lint rule bans the attribute; this test
  removes the motive.

Writing these also surfaced a genuine ambiguity: `getBreaking()` returns
breaking **and** live stories because it feeds the ticker. The first draft of
the test asserted `breaking === true` and failed. The contract was documented
and the test corrected — the code was right.

---

## Not covered yet, and why

| Gap | Blocked on |
| --- | --- |
| Component rendering | Needs a DOM environment and testing-library; deferred to Phase 1 when interactive components exist. The current components are static server output already verified by the build. |
| E2E user journeys | Needs a running app and Playwright; Phase 1, alongside the first authenticated flow. |
| API contract tests | No API exists. |
| Database and migration tests | No database exists. |
| Load tests | No dynamic workload to load. |
| Accessibility assertions | Phase 1, with the design system (§85). |

Stating these plainly matters more than a coverage percentage: 34 tests over
~1,300 lines is a reasonable floor for a static front end and would be a
dangerous illusion of safety for a payments system.

---

## Required per phase

### Phase 1 — Foundation

- Unit: authorization decisions, session lifecycle, content state transitions
- Integration: every `/api/v1` endpoint against a real PostgreSQL instance
- Migration: every migration applies forward and rolls back on a populated database
- E2E: register → verify → sign in → MFA → publish → read
- Security (§53): cross-user profile access, cross-user wallet access, role
  escalation, parameter tampering, session fixation, rate-limit bypass

**Phase 1 does not pass without the §53 cases running in CI.**

### Phase 2 — Reporter economy

- KYC: document access denied to every role but `KYC_ADMIN`; signed URLs expire;
  expired URLs fail closed
- Referrals: self-referral rejected; duplicate accounts detected; attribution
  window enforced; reversal restores the prior state exactly
- Wallet: balance projection equals the ledger sum after every operation

### Phase 3 — Advertising

- Budget: spend never exceeds budget under concurrent impressions
- Targeting: no campaign serves outside its configured geography or language
- Analytics: no raw IP address appears in any advertiser-visible response (§19)

### Phase 4 — Research

- Fraud: duplicate responses, abnormal completion speed, repeated answer
  patterns and multi-account farming are each caught by a test that fails if
  detection regresses
- Rewards: no code path awards a coin without server-side validation
- Reversal: a reversed reward leaves the ledger balanced

### Phase 6 — Value engine

The financial suite from §52, each as an exact-value assertion:

- duplicate payment, duplicate webhook, replayed webhook
- refund, partial refund, failed payment
- currency conversion against a historical rate
- revenue allocation across reader, reporter and company pools
- rounding: allocations sum exactly to the eligible amount, with no lost unit
- tax and commission
- reward reversal after allocation

**Property test:** for any sequence of ledger operations, total debits equal
total credits. This single property catches whole classes of bug that
example-based tests miss.

### Phase 7 — AI

- Prompt injection: ingested content containing instructions does not alter
  pipeline behaviour
- Schema: malformed model output is rejected, never stored
- Gate: no high-risk category can reach `PUBLISHED` without a recorded human
  approval (D-007)

---

## Pipeline

CI (`.github/workflows/ci.yml`) runs on every push and pull request:

```
npm ci → lint → typecheck → test → build → npm audit (runtime deps)
                                         → docker build → container serves
```

The container job builds the image the server actually runs and confirms it
answers on 3100, so a Dockerfile regression is caught in CI rather than during
a deploy on the shared VPS.

The pipeline holds no secrets and deploys nothing (D-008).

---

## Running locally

```bash
cd web
npm run test          # once
npm run test:watch    # watch mode
npm run verify        # lint + typecheck + test + build, as CI runs it
```

`npm run verify` is the command to run before pushing. It is the same sequence
CI runs, so a green local `verify` should mean a green pipeline.
