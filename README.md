# zobia

Zobia Social

## Quick start

```bash
npm install                 # always from the repo root (npm workspaces)
cp apps/web/.env.example apps/web/.env.local   # fill in the values, see docs/SETUP.md
npm run migrate             # apply apps/web/db/migrations
npm run dev:web             # http://localhost:3000
```

Checks: `npm run typecheck`, `npm run test:unit` (web), `npm run test:android`, and `npm run analyze:functions` in `apps/web` after `next build` to see per-deployment function size.
