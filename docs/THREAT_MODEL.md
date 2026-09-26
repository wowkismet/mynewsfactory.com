# Threat Model

Required by §77. Scope: MY NEWS FACTORY 4.0 as specified, assessed against the
system as it exists on 2026-09-20 and as planned.

Each threat carries a status:

- **Live** — the functionality exists and the threat is real today
- **Planned** — the functionality does not exist yet; the mitigation is a
  build requirement, not a backlog item
- **N/A** — not applicable in the current architecture

---

## 1. Assets

Ordered by consequence of compromise, worst first.

| Asset | Why it matters | Exists today |
| --- | --- | --- |
| KYC documents | Government identity documents. Disclosure is irreversible and legally actionable. | No |
| User funds and payouts | Real money owed to reporters. Loss is unrecoverable. | No |
| Financial ledger | The record of what is owed to whom. Corruption is undetectable without it. | No |
| Admin and super-admin accounts | Compromise implies every other asset. | No |
| Payment provider credentials | Enable fraudulent charges and refunds. | No |
| User accounts and PII | Names, emails, phones, locations, reading history. | No |
| Reward coin balances | Convertible value; the target of most fraud. | No |
| Reporter earnings and commissions | Livelihood for contributors. | No |
| Published editorial content | Integrity of the product; defamation exposure. | Fixtures only |
| Advertiser campaign data | Commercially sensitive; competitor value. | No |
| AI provider credentials | Uncapped spend if leaked. | No |
| Source and whistleblower identity | Physical safety of real people. | No |
| Deployment credentials (SSH) | Full host compromise, including rareminting.com. | **Yes** |
| The VPS itself | Shared with another production site. | **Yes** |

The last two are the only assets that exist today, and both are **Live**.

---

## 2. Threat actors

| Actor | Motivation | Capability | Primary targets |
| --- | --- | --- | --- |
| Reward farmers | Money | Scripted, multi-account, cheap | Surveys, polls, referrals, reward coins |
| Fraudulent advertisers | Money, reach | Moderate; stolen cards | Payments, refunds, ad serving |
| Malicious reporters | Money, influence | Authenticated insider | Assignments, earnings, editorial |
| Compromised accounts | Varies | Legitimate credentials | Wallets, payouts, published content |
| Opportunistic attackers | Money, access | Automated scanners | Auth, uploads, injection, misconfiguration |
| Targeted attackers | Data, influence | Skilled, persistent | Admin, KYC, ledger, editorial |
| Insider threat | Money, grievance | Legitimate privileged access | Ledger, KYC, payouts, audit logs |
| Disinformation actors | Influence | Coordinated, patient | AI pipeline, citizen submissions, polls |
| Litigants and subjects of reporting | Suppression, retaliation | Legal and social | Source identity, corrections, takedowns |

Reward farmers deserve emphasis: the specification pays real money for survey
responses and referrals. That makes automated abuse the *default* outcome, not
an edge case. §23 and §16 exist for this reason.

---

## 3. Attack surfaces

| Surface | Status | Notes |
| --- | --- | --- |
| Public website | **Live** | Read-only, statically generated, no user input |
| nginx / TLS on the shared host | **Live** | Shared with rareminting.com |
| SSH to the VPS | **Live** | Key-based |
| Docker daemon and image supply chain | **Live** | Base image `node:22-alpine` |
| Authentication endpoints | Planned | |
| REST API `/api/v1` | Planned | |
| File uploads (media, KYC, creatives) | Planned | Highest-risk planned surface |
| Payment webhooks | Planned | |
| Admin panel | Planned | |
| AI pipeline and its inputs | Planned | Indirect prompt injection via ingested news |
| Mobile app | Planned | |
| Third-party integrations | Planned | |

---

## 4. Threats and mitigations

### T-01 — Reward and referral fraud · Planned · Likelihood: certain

Multi-accounting, scripted survey completion, self-referral through controlled
accounts, click farms, bot traffic.

Mitigations required before any reward pays out (§16, §23):
- Rewards enter `PENDING`; they become `AVAILABLE` only after validation
- Server-side computation of every reward amount; no client input trusted
- Velocity limits per account, device, IP range and payment instrument
- Completion-time floors and answer-pattern analysis on surveys
- Self-referral detection across device, payment instrument and network
- Attribution windows and qualification events for referrals
- Reversal path with a full audit trail
- Manual review queue above a configurable value threshold

**Design constraint:** rewards must be reversible after payment is computed but
before it is settled. A reward architecture without a reversal path cannot
resist this threat regardless of detection quality.

### T-02 — KYC document disclosure · Planned · Likelihood: low · Impact: severe

Mitigations (§9, §57):
- Private object storage only; never a public bucket, never a public path
- Short-lived signed URLs, single-purpose, audit-logged on issue
- Encryption at rest with a separate key from general media
- Access restricted to `KYC_ADMIN`; every access logged with actor and reason
- Retention limits with automated deletion
- Never rendered in any advertiser, reporter or public surface
- Never written to application logs, error reports or analytics

### T-03 — Horizontal privilege escalation (IDOR) · Planned · Likelihood: high

User A reading User B's wallet, KYC, earnings or campaign by changing an ID.

Mitigations (§6, §53):
- Every API verifies ownership server-side; route protection is never the
  control
- Authorization decisions in a single enforced layer, not per-handler
- Opaque identifiers for financial and identity resources
- The §53 test list runs in CI as executable tests, not a checklist

### T-04 — Client-side value tampering · Planned · Likelihood: certain

Altered price, reward amount, commission, currency, user ID or order ID in a
request.

Mitigation: the server recomputes every monetary value from configuration and
server state. Client-supplied amounts are ignored entirely — not validated,
ignored. Any handler that reads a price from the request body is a defect.

### T-05 — Payment replay and duplication · Planned · Likelihood: moderate

Replayed webhooks, duplicate captures, refund abuse.

Mitigations (§14):
- Webhook signature verification before any parsing
- Idempotency keys on every mutating payment operation
- Provider-side status verification; browser redirect is never proof
- Automated reconciliation against provider records (§39)

### T-06 — Malicious file upload · Planned · Likelihood: high

Web shells, malformed media triggering parser bugs, decompression bombs,
SVG-borne XSS, metadata exfiltration.

Mitigations (§9): the full pipeline — authenticate, authorise, size-limit,
content-based MIME detection (never the declared type or extension), malware
scan, metadata strip, transcode to a known-good format, store privately, serve
by signed URL. SVG is never served as `image/svg+xml` from a user-content path.

### T-07 — Indirect prompt injection via ingested content · Planned · Likelihood: high

The AI pipeline ingests third-party news. Any ingested text may contain
instructions aimed at the model.

Mitigations (§54): ingested content is data, never instruction. No unrestricted
database access from AI components. Tool allowlists with narrow scopes.
Structured outputs validated against a schema before storage. Human review for
high-risk categories (D-007). Per-task spend and token caps (§55).

### T-08 — Privileged insider abuse · Planned · Likelihood: low · Impact: severe

Mitigations (§60, §39, §40): immutable audit events for every privileged
action; mandatory MFA for admin roles; step-up authentication for high-value
financial actions; separation of duties between approval and execution on
payouts; audit logs access-controlled and not editable by the roles they
record.

### T-09 — Shared-host compromise or collision · **Live** · Likelihood: moderate

mynewsfactory.com and rareminting.com share one VPS, one nginx and one TLS
termination point. A compromise of either reaches the other. A misconfiguration
of either can take down the other — and has: an earlier deployment step in this
project terminated rareminting's application process.

Mitigations in place: container isolation with `cap_drop: ALL`,
`no-new-privileges`, non-root user, loopback-only port publishing, distinct
ports (3000 / 3100), and deployment scripts that refuse to modify or terminate
anything belonging to the other site.

Residual risk is real and accepted for now. Separate hosts are the correct
answer before either site carries user data.

### T-10 — Supply chain compromise · **Live** · Likelihood: low

Three runtime dependencies today, which is the strongest position this system
will ever be in. Mitigations: lockfile committed, `npm ci` in the build,
automated `npm audit` in CI (D-008), container image scanning, SHA-pinned
GitHub Actions, and a deliberate bias against adding dependencies.

### T-11 — Editorial integrity attack · Planned · Likelihood: moderate

Coordinated false citizen submissions, manipulation of story clustering,
defamatory content published through an under-reviewed path.

Mitigations (§58, §59): explicit content state machine; no auto-publication of
unverified high-risk submissions; versioned articles with preserved history;
corrections that never destroy the original; source attribution retained
through the pipeline.

### T-12 — Source and contributor exposure · Planned · Likelihood: low · Impact: severe

A citizen reporting on local corruption can be identified through submission
metadata, image EXIF, precise location, or an analytics join.

Mitigations: strip EXIF on ingest; coarsen location where reporting sensitivity
warrants; never expose reporter location precisely in public surfaces; treat
source identity as a higher-classification asset than general PII. This threat
is not named in the specification and is added here deliberately — the product
explicitly recruits citizen reporters in their own cities.

### T-13 — Denial of service and cost amplification · Planned · Likelihood: moderate

Unbounded feed queries, expensive search, uncapped AI calls, video transcoding
abuse.

Mitigations (§45, §55, §71): cursor pagination everywhere; per-role and
per-endpoint rate limits; per-user and per-organisation AI budgets; transcoding
in a bounded queue with per-account quotas; CDN in front of media.

### T-14 — Credential exposure through operational channels · **Live** · Likelihood: realised

A private SSH key was transmitted through a chat channel during deployment
setup in this project's history.

Mitigation: rotate that key and remove the corresponding public key from the
server's `authorized_keys`. Going forward, private keys are generated on the
machine that will use them and never transit a channel that is not purpose-built
for secrets. Secret *values* are copied console-to-vault, never pasted into a
conversation.

**This is an open action, not a closed one.**

---

## 5. Security acceptance gate

Per §78, production readiness for any phase handling money or identity
requires all of:

| Control | Status |
| --- | --- |
| No critical vulnerabilities | Not assessed — no scanning in place |
| No high-risk authorization issues | N/A — no authenticated surface |
| Secrets secured | Partial — none committed; one key needs rotation (T-14) |
| Production environment separated | **Fail** — no staging environment exists |
| Database backups working | N/A — no database |
| Restore test succeeds | **Fail** — never performed |
| Payment webhooks verified | N/A |
| Financial ledger reconciles | N/A |
| MFA works | N/A |
| Audit logs work | N/A |
| File uploads secured | N/A |
| Rate limiting works | **Fail** — none |
| Monitoring works | **Fail** — none |
| Alerts work | **Fail** — none |
| CI/CD works | **Fail** — removed at `1c77b31` |
| Rollback works | **Fail** — manual redeploy only |
| E2E critical paths pass | **Fail** — no tests |

The system does not meet the gate. It does not currently need to: it handles no
money, no identity and no accounts. It must meet the gate before Phase 2 ships
anything that writes user data, and in full before Phase 6.

---

## 6. Review cadence

This model is revised at the start of every phase in `IMPLEMENTATION_PLAN.md`,
and whenever a new asset class, actor or external integration is introduced.
A phase is not complete until its threats carry implemented, tested mitigations.
