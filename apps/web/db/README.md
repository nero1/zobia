# PostgreSQL baseline

`migrations/0001_consolidated_schema.sql` is the complete final state including the forensic hardening review. The migration directory contains one SQL file. It declares 317 tables once, with final columns, checks, primary/unique keys, indexes, foreign keys, functions, triggers, RLS and 809 reference/configuration rows. Foreign keys follow reference inserts to resolve circular references; triggers are installed after importing their already-materialized reference data. Historical column alterations, backfills and temporary schema states are absent.

## Fresh installation

**After a table-only wipe:** `DROP TABLE … CASCADE` can leave baseline functions behind, causing error `42723`. Run [the guarded function cleanup](maintenance/clear-orphaned-baseline-functions.sql) in SQL Editor, then rerun the full baseline. Cleanup refuses remaining application tables/views/sequences; do not drop provider schemas.

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

A database with all 39 predecessor checksums is automatically adopted only after its application catalog matches the baseline fingerprint. This synchronizes the baseline access allowlist and updates migration history without replaying seeds or replacing existing data/settings. Previous history entries remain recorded.

If this exact SQL file was applied manually, register it after catalog verification:

```sh
DIRECT_URL='postgresql://...' npm run migrate -- --adopt-baseline
```

Incomplete/modified history or a nonmatching schema is rejected. Do not reset an existing database or mark missing files as applied. Complete the original migration chain using an isolated checkout at `8c20d630`, then return to this revision and migrate. The predecessor filenames/checksums and final catalog fingerprint are in `baselines/2026-10-23.json`; original SQL remains in Git history. Adoption applies the same explicit grants/revocations as a fresh installation before recording history, so older inherited client grants cannot survive on private tables. Application settings and content are preserved; custom client table grants are replaced by the baseline allowlist.

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

Add future changes as new numbered SQL files (starting with `0002_<new_name>.sql`). Do not edit an applied baseline. Optional administrator-owned starter content lives in `seed.sql`; see the [SQL Editor guide](../../../docs/SEED-CONTENT.md). It adds content and 80 quest templates without accounts, privileges, balances or fabricated activity. For the developer runner, set `SEED_OWNER_EMAIL` to an active verified administrator and use `npm run seed` or the runner’s `--seed` option; this uses the same SQL transaction.

## Upgrading the previous consolidated baseline

The runner recognizes the verified previous baseline checksum and catalog. It applies `upgrades/2026-10-23-forensic-hardening.sql` transactionally, verifies the resulting catalog, synchronizes permissions and records the current baseline checksum. This upgrade is separate from the sole fresh-install migration. Unknown schema drift aborts without changing application data. Keep a recoverable database/object backup and validate an isolated restore before upgrading a live installation.

The final schema has 317 tables and three security-invoker ledger history views. Platform roles are never created by the baseline; private tables, including phone verification and recovery queues, are not exposed to anon/authenticated roles. `service_role` receives explicit table permissions. Ordinary PostgreSQL application transactions establish transaction-local system context through the pool wrapper; request-scoped RLS contexts set both supported user settings and cannot leak through pooled connections.
