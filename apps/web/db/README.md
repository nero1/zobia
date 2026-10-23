# PostgreSQL baseline

`migrations/0001_consolidated_schema.sql` is the complete final state after the former 0001–0039 migrations at commit `8c20d630`. The migration directory contains one SQL file. It declares 309 tables once, with final columns, checks, primary/unique keys, indexes, foreign keys, functions, triggers, RLS and 809 reference/configuration rows. Foreign keys follow reference inserts to resolve circular references; triggers are installed after importing their already-materialized reference data. Historical column alterations, backfills and temporary schema states are absent.

## Fresh installation

Use a direct PostgreSQL connection with an empty application schema. PostgreSQL 16+ and the stock `pgcrypto`, `uuid-ossp` and `pg_trgm` extensions are required. Existing extension namespaces are resolved without relocating provider-owned extensions; the migration role needs usage on those namespaces. The database owner can install missing trusted extensions; `pg_stat_statements` is optional and does not block installation when unavailable.

From the repository root:

```sh
DIRECT_URL='postgresql://...' npm run migrate
```

Or execute just the SQL file, including from a SQL editor:

```sh
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f apps/web/db/migrations/0001_consolidated_schema.sql
```

The SQL file is a single transaction and refuses an existing application schema. Use the runner on subsequent deploys; it tracks checksums and pending migrations, serializes concurrent runs and records each file in the same transaction as its DDL/data. It accepts `DIRECT_URL`, falling back to `DATABASE_URL`. `--status` performs no schema/history writes.

## Existing databases and manually applied SQL

A database with all 39 predecessor checksums is automatically adopted only after its application catalog matches the baseline fingerprint. This updates migration history without replaying seeds or replacing existing data/settings. Previous history entries remain recorded.

If this exact SQL file was applied manually, register it after catalog verification:

```sh
DIRECT_URL='postgresql://...' npm run migrate -- --adopt-baseline
```

Incomplete/modified history or a nonmatching schema is rejected. Do not reset an existing database or mark missing files as applied. Complete the original migration chain using an isolated checkout at `8c20d630`, then return to this revision and migrate. The predecessor filenames/checksums and final catalog fingerprint are in `baselines/2026-10-23.json`; original SQL remains in Git history. Adoption does not retrofit grants or overwrite intentional live settings. The explicit grants described below apply when installing the new baseline.

## Provider-neutral permissions

The SQL does not create Supabase roles or use `auth.uid()`, `auth.users`, Supabase extensions or platform schemas. On Railway, DigitalOcean or another PostgreSQL host, the configured owning application role works normally. A separately provisioned non-owner runtime role needs its own intentional grants/RLS configuration. Retain the provider’s runtime search path when extensions live outside `public`; application queries that call extension functions need that namespace available.

If `anon`, `authenticated` or `service_role` exist, their grants/policies are installed conditionally. Existing client access is preserved, private tables receive no client grants, and every application table gets explicit service-role CRUD grants. Inherited `PUBLIC`/client default grants are revoked on the application tables before applying the allowlist, so broad provider defaults cannot expose private records. No roles are created, altered or granted `BYPASSRLS` by the baseline. Supabase provisions its trusted service role itself. Required RLS policies using those role names are skipped when the roles are absent; provider-neutral policies remain.

## Verification and future changes

Seven integration checks cover fresh/repeated/concurrent installs, read-only status, manual/legacy adoption, partial history, file drift and transactional rollback. CI also runs the portability fixture on an empty local PostgreSQL cluster, first as a non-superuser owner with no platform roles, then with Supabase-style roles and broad default grants:

```sh
BASELINE_PORTABILITY_TEST=1 TEST_DATABASE_URL='postgresql://...@localhost/zobia_test' \
  npm exec --workspace=apps/web -- tsx db/test-baseline-portability.ts
```

That fixture requires a dedicated empty local test cluster; it creates and removes test databases and roles. It refuses remote hosts, a populated control database and pre-existing platform roles.

To reproduce equivalence against a disposable database built from the old migration chain:

```sh
REFERENCE_DATABASE_URL='postgresql://...' BASELINE_DATABASE_URL='postgresql://...' \
  npm exec --workspace=apps/web -- tsx db/verify-baseline.ts --platform-access
```

The comparison is read-only. Omit `--platform-access` when comparing a role-free installation; platform grants/policies are necessarily absent there. It compares all application tables/reference rows and the final catalog, including generated columns, constraints, indexes, functions, triggers and provider-neutral policies. Platform mode additionally compares all policies/client privileges and checks service-role grants and private-receipt denial.

Add future changes as new numbered SQL files (starting with `0002_<new_name>.sql`). Do not edit an applied baseline. Optional demo accounts/content remain in `seed.sql` for local development only; `npm run migrate -- --seed` installs them separately and transactionally.
