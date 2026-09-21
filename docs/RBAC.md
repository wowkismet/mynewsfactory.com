# Authorization

Phase 1b of `IMPLEMENTATION_PLAN.md`. The 22 roles of §6, with scoped grants.

---

## The shape of it

- **Permissions are verbs on resources** — `news.publish`, `finance.payout`,
  `kyc.read`. Code asks whether an actor may *do a thing*, never whether they
  *are a role*. Adding a role later is then a data change, not a hunt through
  the codebase for every place a role name was compared.
- **Roles are bundles of permissions.** Defined in `auth/roles.ts`, synced into
  the database, which is the runtime source of truth.
- **Grants are rows** with a scope. Revoking one takes effect on the next
  request — there is no role cached on the session.

A startup check refuses to boot if a role references a permission that is not
in the catalogue. A typo would otherwise be a permission no check ever matches,
reading as "denied" right up until someone adds the real permission and the
role silently gains it.

---

## Scope

A grant is `GLOBAL`, or scoped to a `COUNTRY` or a `CITY` (§6, §34). A database
constraint keeps the scope column and its target from disagreeing: a `COUNTRY`
grant must name a country and must not name a city.

The rule that does the security work:

> A scoped grant authorises action **in that scope and nowhere else** —
> including when the request supplies no scope at all.

Omitting the scope is the obvious way to try to escalate, so an unscoped
request requires an unscoped grant. A Mumbai editor cannot publish a national
story by leaving the city out of the request. This is a test:

```
refuses a scoped grant when no scope is supplied, so omitting it is not an escalation
```

---

## The roles

Eleven privileged roles act on the platform. They require MFA (§7) and appear
in the security dashboard (§40): `SUPER_ADMIN`, `ADMIN`, `EDITOR`,
`NEWS_ADMIN`, `KYC_ADMIN`, `FINANCE_ADMIN`, `AD_ADMIN`, `SURVEY_ADMIN`,
`REWARD_ADMIN`, `SECURITY_ADMIN`, `AI_ADMIN`.

Eleven are people using the platform: `REPORTER`, `VERIFIED_REPORTER`,
`CITIZEN_CONTRIBUTOR`, `CREATOR`, `READER`, `VIEWER`, `ADVERTISER`,
`BUSINESS`, `ASSIGNMENT_PROVIDER`, `RESEARCH_CLIENT`, `CLIENT`.

Two separations are deliberate and tested:

- **`kyc.read` belongs to `KYC_ADMIN` alone.** Not to `ADMIN`, not to
  `SUPER_ADMIN`'s day-to-day equivalent. Identity documents are the asset whose
  disclosure is irreversible (`THREAT_MODEL.md` T-02), so the set of people who
  can read them is as small as the product allows.
- **`AI_ADMIN` configures the pipeline but cannot publish.** D-007 puts
  publication of high-risk content behind a named human editor; an AI
  administrator is not that editor.

---

## Asking the question

```ts
const grants = await resolveGrants(db, userId)

if (!can(grants, 'news.publish', { cityId })) { /* 403 */ }

// Or, when the audit record needs to say which grant allowed it:
const via = require_(grants, 'news.publish', { cityId })
```

`decide` returns the grant that permitted the action, for the audit event.
`AuthorizationError`'s message names the permission for the log; what reaches a
client is a generic 403. Telling someone which permission they lack maps the
authorization model for them.

---

## Audit

Every privileged action writes an `audit_events` row (§60) carrying the actor,
their role, the action, the resource, before and after state, a keyed hash of
the address and a request id.

`recordAudit` takes a database handle, so a caller inside a transaction passes
the transaction and **the event commits or rolls back with the change it
describes**. An audit log that can disagree with the data is worse than none.

The table is append-only, enforced by `BEFORE UPDATE` and `BEFORE DELETE`
triggers. See `DATABASE.md` for the one way around that and the operational
control that closes it.

---

## Not done yet

- **Ownership checks are not here.** "Is this campaign yours" is a resource
  question that lives with the resource. RBAC answers the permission question;
  both must pass. Phase 1c, with the endpoints.
- **No organisation-level grants** (§6). The scope enum has room.
- **No UI for granting roles.** `grantRole` and `revokeRole` exist; the admin
  surface is Phase 1d.
