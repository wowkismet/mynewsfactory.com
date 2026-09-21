# Database

PostgreSQL schema, access layer and operational procedures. Phase 1a of
`IMPLEMENTATION_PLAN.md`.

---

## Access layer

There is no ORM. The application talks to PostgreSQL through a two-method
interface (`web/src/lib/db/client.ts`) satisfied by node-postgres in production
and by an in-process PostgreSQL engine in tests. Reasons are in `DECISIONS.md`
D-011; the short version is that every query is parameterised SQL, so injection
is prevented by construction, and tests run against real PostgreSQL rather than
a mock.

```
src/lib/db/
  client.ts      Db interface and transaction helper
  pool.ts        production connection pool
  migrate.ts     migration runner with checksum enforcement
  repository.ts  editorial queries
  cursor.ts      opaque keyset cursors
  seed.ts        development and test fixtures
  testing.ts     in-process PostgreSQL for tests
migrations/
  0001_core.sql
  0001_core.down.sql
```

---

## Schema

Migration `0001_core` creates reference data, people and the newsroom.

| Table | Purpose |
| --- | --- |
| `currencies` | ISO 4217 code and minor-unit exponent |
| `languages` | BCP 47 code, display name, RTL flag |
| `countries` | Country, its currency and default language, activation flag |
| `states` | Sub-national divisions, unique per country |
| `cities` | City newsrooms; slug is globally unique because it is a route |
| `users` | The identity anchor. Authentication is Phase 1b |
| `reporters` | A role a user holds, not a separate identity |
| `reporter_languages` | Which languages a reporter files in |
| `categories` | Editorial sections |
| `news` | A story and its current state |
| `news_versions` | Append-only editorial history |
| `news_media` | Storage keys, never public URLs |

Migration `0002_identity` adds authentication and authorization.

| Table | Purpose |
| --- | --- |
| `user_credentials` | Argon2id password hashes, one per account |
| `user_tokens` | Single-use email verification and password reset tokens |
| `sessions` | Live sessions with device context; addresses keyed-hashed |
| `refresh_tokens` | Single-use refresh tokens with a rotation chain |
| `mfa_credentials` | TOTP secrets, encrypted at rest |
| `mfa_recovery_codes` | Hashed, single-use recovery codes |
| `roles`, `permissions`, `role_permissions` | The authorization catalogue |
| `user_roles` | Grants, optionally scoped to a country or city |
| `audit_events` | Append-only record of privileged actions |
| `login_attempts` | Keyed-hash attempt log backing lockout |

### Guarantees the database makes on its own

These hold even when application code is wrong, which is why they are in the
schema rather than in a service layer. Each is covered by a test in
`schema.test.ts`.

- **Slugs are URL-safe.** A `CHECK` constrains every slug to
  `^[a-z0-9]+(-[a-z0-9]+)*$`, so a route parameter is validated by the database
  as well as by the application. A path-traversal string cannot be stored.
- **Email uniqueness cannot be bypassed by case.** Addresses must be stored
  lowercase, so `Alice@example.com` and `alice@example.com` cannot coexist.
- **A published story has a publication time; an unpublished one does not.**
  A single `CHECK` makes the two columns impossible to disagree.
- **Editorial history is append-only.** `BEFORE UPDATE` and `BEFORE DELETE`
  triggers on `news_versions` raise. A correction appends a version; it cannot
  rewrite one (§59).
- **Editorial content is never destroyed by a parent delete.** Foreign keys
  state their behaviour: `RESTRICT` by default, `SET NULL` where a reference is
  optional, `CASCADE` only for media that belongs to one story.
- **`updated_at` is maintained by the database**, not by whichever code path
  happened to remember.
- **Only Argon2id password hashes can be stored.** A `CHECK` on the prefix
  means a weaker algorithm cannot be written even by code that tries.
- **A revoked session must carry a reason**, so the security dashboard never
  shows a revocation nobody can explain.
- **A role grant's scope and its target cannot disagree.** A `COUNTRY` grant
  must name a country and must not name a city.
- **At most one live refresh token per session**, by partial unique index —
  true even if the rotation code is wrong.

### The limit of the append-only guard

`BEFORE UPDATE` and `BEFORE DELETE` triggers make `news_versions` and
`audit_events` append-only. **`TRUNCATE` does not fire row-level triggers**, so
it bypasses both. That is how PostgreSQL works, not a gap in the trigger.

The control is a privilege, not a trigger: **the application's database role
must not own these tables and must not hold `TRUNCATE` on them.** Migrations
run as a separate, more privileged role.

This is not yet configured — the deployment uses a single role — and it is
recorded here rather than left implicit. It belongs with the backup work in
Phase 1e, since both are about what an operator can destroy.

### Money

There are no money columns in this migration, deliberately. Amounts must be
integer minor units with an explicit currency from their first migration
(`DECISIONS.md` D-003), and that belongs with the ledger in Phase 6 — not
retrofitted onto tables created earlier.

`currencies.minor_unit` exists now because country configuration needs it.

---

## Pagination

Listings are keyset-paginated on `(published_at DESC, id DESC)`, matching the
partial indexes. Offset pagination is not offered: it degrades as the table
grows, and it skips or repeats rows when the data changes between requests,
which on a news feed it constantly does.

Cursors are opaque, base64url-encoded, and validated on decode — they arrive
from the client, so a malformed or forged one yields "start from the
beginning" rather than an error or a query. Page sizes are clamped to 100.

Each query fetches `limit + 1` rows to determine whether a further page exists,
avoiding a `COUNT` over a growing table.

---

## Visibility

Every query in `repository.ts` filters `status = 'PUBLISHED'`. An unpublished
story is not hidden by the interface; it is excluded by the query. This is
tested directly: a story moved to `UNPUBLISHED` disappears from both the article
route and every listing.

---

## Migrations

```bash
cd web
npm run db:migrate    # apply everything unapplied
npm run db:seed       # development and test only
```

Each migration runs in its own transaction: a failure leaves the database
exactly as it was. Applied migrations are recorded with a SHA-256 of their
contents, and a migration whose file changes after it has run causes the next
run to **fail** rather than silently skip it — the case where a developer's
database and production's have diverged without anyone noticing.

Every migration has a `.down.sql` (§83). Down migrations are destructive by
definition and are for development and rollback rehearsal; running one against
a database holding real editorial content requires a verified backup first.

### Adding a migration

1. `migrations/NNNN_name.sql` and `migrations/NNNN_name.down.sql`
2. Forward-only: never edit an applied migration; add a new one
3. Add tests to `schema.test.ts` for any guarantee the migration introduces
4. `npm test` — the suite applies migrations from scratch on every run

---

## Seeding

`npm run db:seed` inserts the demonstration fixtures. It **refuses to run when
`NODE_ENV=production`** (§81, `DECISIONS.md` D-010): production reads real
editorial content and should fail to start rather than serve invented articles
under real reporter names.

The seed fails loudly on unresolved references — an unknown country or
language raises rather than inserting a row with a missing link. A reporter
silently losing a language is the kind of quiet data loss only noticed once it
is in production.

---

## Local development

```bash
cp web/.env.example web/.env.local     # fill in DATABASE_URL
docker compose --profile db up -d db   # PostgreSQL is opt-in until the
                                       # pages read it; see below
cd web && npm run db:migrate && npm run db:seed
```

The database sits behind a compose profile on purpose. The portal's pages
still read fixtures, so a plain `docker compose up -d` deploys the site and
does not require a database to exist. Compose interpolates the entire file
regardless of which profiles are active, so requiring `POSTGRES_PASSWORD`
with the `:?` form would have blocked every deploy, database or not — it
did, once. The postgres image refuses to initialise without a password and
says so clearly, which gives the same protection at the point it matters.

`POSTGRES_PASSWORD` has no default: compose refuses to start without it rather
than falling back to something guessable. Generate one with
`openssl rand -base64 32`.

The database publishes no host port. It is reachable only on the compose
network — nothing outside those containers needs it, and the server is shared
with another production site.

---

## Connection security

`pool.ts` requires TLS with certificate verification unless the connection
string carries `sslmode=disable`, which is correct only for a database that
never crosses a network. The compose file uses it for the container-network
connection and nowhere else.

The pool is bounded (default 10 per process) so a request burst queues rather
than exhausting the server's connection slots. Statements time out at 15
seconds. Idle-client errors are handled explicitly — an unhandled `error` event
on a pool takes the process down.

---

## Not yet done

- **The portal still reads fixtures.** `content.ts` has not been rewired to the
  repository. That change turns build-time static generation into database
  reads and is the next step of Phase 1a.
- **No backups.** §48 requires automated backups, a tested restore and
  `DISASTER_RECOVERY.md`. None exists. This is a Phase 1e deliverable and is
  scored as a failure in `THREAT_MODEL.md`.
- **No read replica, no connection proxy.** Neither is needed at current scale.
