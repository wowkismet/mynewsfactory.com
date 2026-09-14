# My News Factory

The world's people-powered global news, media, research, advertising and rewards network.

This repository currently contains **Phase 1 — the public portal front end**.

## What is here

| Path | Contents |
| --- | --- |
| `web/` | Next.js 16 + TypeScript portal (App Router, React 19) |
| `web/src/app` | Routes: home, article, category, city |
| `web/src/components` | Masthead, navigation, ticker, story cards, panels |
| `web/src/lib/content.ts` | Editorial data source — swap for PostgreSQL in Phase 2 |
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
npm run typecheck    # tsc --noEmit
```

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
- `npm audit` reports 0 vulnerabilities at the time of commit

## Deploying to the VPS

The site builds to a Node server. On the host:

```bash
cd web && npm ci && npm run build
npm run start -- -p 3000
```

Then point the existing nginx vhost for `mynewsfactory.com` at
`http://127.0.0.1:3000` with `proxy_pass`, replacing the static `root`, and
reload nginx. Run the Node process under systemd so it survives reboots.

## Not in this phase

Authentication, the reporter and admin panels, payments, wallets, reward coins,
KYC, the revenue allocation engine, the fraud engine and the AI pipeline are all
out of scope here. Anything touching money or identity documents needs real
infrastructure and an independent security and financial audit before it handles
live funds.
