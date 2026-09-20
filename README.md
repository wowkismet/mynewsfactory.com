# My News Factory

The world's people-powered global news, media, research, advertising and rewards network.

This repository currently contains **Phase 1 — the public portal front end**.

## What is here

| Path | Contents |
| --- | --- |
| `web/` | Next.js 16 + TypeScript portal (App Router, React 19) |
| `web/src/app` | Routes: home, article, category, city |
| `web/src/components` | Masthead, navigation, ticker, story cards, panels |
| `web/src/lib/db/` | PostgreSQL access: migrations runner, repository, cursors, seed |
| `web/migrations/` | Schema migrations, each with a rollback |
| `web/src/lib/content.ts` | Fixture accessors the pages still use; the repository replaces them next |
| `web/src/lib/pricing.ts` | Central pricing configuration — no price is hard-coded |

## Routes

- `/` — front page: hero, Live World panel, Live Now rail, Top News, services, My City
- `/news/[slug]` — article
- `/category/[slug]` — section listing
- `/city/[slug]` — city newsroom ("every city has a newsroom")

## Running locally

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

```bash
npm run build        # production build
npm run start        # serve the build
npm run lint         # eslint, type-aware
npm run typecheck    # tsc --noEmit
npm run test         # vitest
npm run verify       # everything CI runs, in CI's order
```

```bash
docker compose --profile db up -d db   # opt-in; the pages still read fixtures
cd web && npm run db:migrate && npm run db:seed
```

## Documentation

Engineering documentation lives in `docs/`:

| Document | Contents |
| --- | --- |
| `ARCHITECTURE_AUDIT.md` | What this repository actually contains, measured |
| `IMPLEMENTATION_PLAN.md` | Phased plan from here to the full platform |
| `THREAT_MODEL.md` | Assets, actors, threats, mitigations, acceptance gate |
| `DECISIONS.md` | Engineering decisions, with reasons and alternatives |
| `TESTING.md` | Test strategy, current coverage, per-phase requirements |
| `DATABASE.md` | Schema, access layer, migrations, seeding, operations |

Read `ARCHITECTURE_AUDIT.md` first. It is candid about the gap between this
repository and the full specification.

## Design system

Taken from the approved portal design: warm newsprint palette (`#f3efe8` paper,
`#17140f` ink), Source Serif 4 for editorial type, Libre Franklin for interface,
IBM Plex Mono for labels and data, with oklch accents. All tokens live at the top
of `web/src/app/globals.css`.

## Pricing

Every displayed price comes from `web/src/lib/pricing.ts`, which mirrors the
`pricing_config` table planned for Phase 2. Changing a value there updates the
portal everywhere it appears.

Defaults follow the specification: reporter training ₹2,500; referral reward 20%;
advertising ₹50–₹5,000 per day; surveys ₹50–₹500 per valid response; interview
and success story bookings ₹10,000 plus applicable taxes.

## Security

- Content-Security-Policy, HSTS, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy` and `Permissions-Policy` set in `web/next.config.mjs`
- `poweredByHeader` disabled
- No `dangerouslySetInnerHTML` anywhere; article bodies render as escaped text
- `npm audit` reports 0 vulnerabilities, including dev dependencies
- Type-aware ESLint bans `dangerouslySetInnerHTML`, `innerHTML`, `eval` and
  dynamic `Function` construction outright
- CI verifies every push: lint, typecheck, test, build, dependency audit, and a
  container build that must serve a request before the job passes

## Deploying

The portal runs as a Docker container on the VPS, published on the host's
loopback at port 3100. nginx proxies `mynewsfactory.com` to it.

To deploy an update:

```bash
cd /srv/mynewsfactory
git pull
docker compose up -d --build
```

This starts the portal only. PostgreSQL is behind the `db` profile until the
pages read it:

```bash
docker compose --profile db up -d
```

The container listens on 3000 inside its own network namespace and is reachable
on the host only at 127.0.0.1:3100. Host port 3000 belongs to rareminting.com,
which shares this server — keep it that way.

`deploy/` also holds a systemd unit, the nginx vhost and an installer for a
non-container deployment; the container is the one in use.

## Not in this phase

Authentication, the reporter and admin panels, payments, wallets, reward coins,
KYC, the revenue allocation engine, the fraud engine and the AI pipeline are all
out of scope here. Anything touching money or identity documents needs real
infrastructure and an independent security and financial audit before it handles
live funds.
