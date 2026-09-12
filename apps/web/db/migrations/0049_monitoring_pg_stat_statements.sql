-- 0049_monitoring_pg_stat_statements.sql
--
-- Enables pg_stat_statements (a stock Postgres extension, not a third-party
-- APM) so the /gate44/monitoring dashboard can report real slow-query stats
-- (lib/db/slowQueries.ts) with zero added overhead: it aggregates timing in
-- shared memory as queries run — this migration only makes the existing
-- data queryable, it doesn't add any new tracking.
--
-- Two things must both be true for this to actually work, and CREATE
-- EXTENSION alone only handles the first one:
--   1. pg_stat_statements is loaded via shared_preload_libraries (a Postgres
--      SERVER-level config, requires a restart — most managed providers,
--      including Supabase/RDS/Neon/Railway, ship this preloaded by default).
--   2. The extension is created in this database (what this migration does).
-- If (1) isn't true, CREATE EXTENSION can still succeed here, but querying
-- pg_stat_statements will fail at runtime with "pg_stat_statements must be
-- loaded via shared_preload_libraries" — lib/db/slowQueries.ts catches that
-- (and any other failure, e.g. the extension not existing at all) and
-- reports `available: false`, so the monitoring dashboard degrades to "not
-- available" instead of breaking either way. If you hit that on self-hosted
-- Postgres, add pg_stat_statements to postgresql.conf's shared_preload_libraries
-- and restart — no migration re-run needed once the extension already exists.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_stat_statements could not be enabled (%). Slow-query stats on /gate44/monitoring will show as unavailable until this extension is enabled at the server level — see docs/SETUP.md.', SQLERRM;
END
$$;
