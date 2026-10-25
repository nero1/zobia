# zobia

Zobia Social

## Quick start

For dashboard deployment, see [SETUP.md](docs/SETUP.md). A table-only wipe leaves helper functions behind; use its guarded cleanup instructions before reinstalling the baseline.

```bash
npm install                 # always from the repo root (npm workspaces)
cp apps/web/.env.example apps/web/.env.local   # fill in the values, see docs/SETUP.md
npm run migrate             # apply apps/web/db/migrations
npm run dev:web             # http://localhost:3000
```

Checks: `npm run typecheck`, `npm run test:unit` (web), `npm run test:android`, and `npm run analyze:functions` in `apps/web` after `next build` to see per-deployment function size.
