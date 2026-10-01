# zobia

Zobia Social, inspired by 2go: a gamified, monetised social platform (rooms, DMs, guilds, tweets, blogs, forums, games, classrooms, portals) with XP tracks, seasons, coins and creator payouts.

## Apps

| Path | What it is |
|---|---|
| `apps/web` | Next.js 15 (App Router) web app, PWA, API routes and the `/gate44` admin panel. Deployed on Vercel. |
| `apps/android` | Capacitor 6 + Vite + React Android app. Mirrors the mobile web UI and calls the same API. |
| `apps/expo` | Discontinued Expo app, kept for reference only. |
| `shared` | Shared types, utilities and i18n locales (used by Android). |

## Docs

- [`ZobiaSocial-PRD.md`](ZobiaSocial-PRD.md): product requirements and the change log of every release.
- [`docs/SETUP.md`](docs/SETUP.md): environment variables, database and migrations, CRON setup, Vercel Hobby limits and how to read Observability.
- [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md): architecture and the reasoning behind it, including *Running on Vercel Hobby (free plan): reference* (deploy storage, Active CPU, caching rules).
- [`SEO.md`](SEO.md): SEO conventions.

## Quick start

```bash
npm install                 # always from the repo root (npm workspaces)
cp apps/web/.env.example apps/web/.env.local   # fill in the values, see docs/SETUP.md
npm run migrate             # apply apps/web/db/migrations
npm run dev:web             # http://localhost:3000
```

Checks: `npm run typecheck`, `npm run test:unit` (web), `npm run test:android`, and `npm run analyze:functions` in `apps/web` after `next build` to see per-deployment function size.
