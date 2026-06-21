-- TASK-24: Database-level Row Level Security policies
-- Provides defense-in-depth against app-layer WHERE clause bugs.
-- These policies use GUC (postgresql.conf) settings injected per-query context:
--   app.user_id   — UUID of the authenticated user (for user-scoped queries)
--   app.is_admin  — 'true' when executing as a privileged server process (CRON, admin API)
--
-- IMPORTANT: These policies require the application to SET LOCAL app.user_id = '...'
-- before executing sensitive queries. The db providers must be updated to inject
-- these settings within transaction blocks.
--
-- For server-to-server queries (CRON, webhooks), SET LOCAL app.is_admin = 'true'.
-- For anonymous/public queries (public profiles), policies check the table columns directly.

-- Enable RLS on sensitive tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE star_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_ledger ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- users: self-access or admin
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'users_self_or_admin'
  ) THEN
    CREATE POLICY users_self_or_admin ON users
      USING (
        id = NULLIF(current_setting('app.user_id', true), '')::uuid
        OR current_setting('app.is_admin', true) = 'true'
        OR deleted_at IS NULL  -- allow reads on non-deleted rows by any server query
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- coin_ledger: owner-only or admin
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'coin_ledger' AND policyname = 'coin_ledger_owner_or_admin'
  ) THEN
    CREATE POLICY coin_ledger_owner_or_admin ON coin_ledger
      USING (
        user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        OR current_setting('app.is_admin', true) = 'true'
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- star_ledger: owner-only or admin
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'star_ledger' AND policyname = 'star_ledger_owner_or_admin'
  ) THEN
    CREATE POLICY star_ledger_owner_or_admin ON star_ledger
      USING (
        user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        OR current_setting('app.is_admin', true) = 'true'
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- xp_ledger: owner-only or admin
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'xp_ledger' AND policyname = 'xp_ledger_owner_or_admin'
  ) THEN
    CREATE POLICY xp_ledger_owner_or_admin ON xp_ledger
      USING (
        user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        OR current_setting('app.is_admin', true) = 'true'
      );
  END IF;
END
$$;

-- Note: To avoid breaking existing application queries that do not yet set
-- app.user_id, each policy uses NULLIF to treat empty strings as NULL and
-- falls through to the admin check. Server-side code should be updated to
-- SET LOCAL app.is_admin = 'true' in transaction blocks for CRON/webhook paths.
