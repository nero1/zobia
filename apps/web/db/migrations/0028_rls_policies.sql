-- Migration 0028: Row Level Security policies for high-value tables
-- TASK-08 (BUG-SEC-03): Enable RLS on financial, privacy-sensitive, and social tables.
--
-- Design: policies ALLOW access when app.current_user_id is NOT set (empty string),
-- which preserves the pre-RLS behaviour for CRON jobs, admin routes, and background
-- workers that use db.query() without withRLS(). When withRLS() IS used, the GUC is
-- set to the authenticated user's ID and the user-isolation condition kicks in.
--
-- This avoids the service_role role-name assumption which differs across providers
-- (Supabase: 'service_role'; Railway: 'postgres'/'railway'; DO: 'doadmin').
-- Instead, the open-when-empty pattern makes RLS provider-agnostic.

-- ---------------------------------------------------------------------------
-- coin_ledger
-- ---------------------------------------------------------------------------
ALTER TABLE coin_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY coin_ledger_isolation ON coin_ledger
  FOR ALL
  USING (
    current_setting('app.current_user_id', TRUE) = ''
    OR user_id::text = current_setting('app.current_user_id', TRUE)
  );

-- ---------------------------------------------------------------------------
-- star_ledger
-- ---------------------------------------------------------------------------
ALTER TABLE star_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY star_ledger_isolation ON star_ledger
  FOR ALL
  USING (
    current_setting('app.current_user_id', TRUE) = ''
    OR user_id::text = current_setting('app.current_user_id', TRUE)
  );

-- ---------------------------------------------------------------------------
-- payout_requests
-- ---------------------------------------------------------------------------
ALTER TABLE payout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY payout_requests_isolation ON payout_requests
  FOR ALL
  USING (
    current_setting('app.current_user_id', TRUE) = ''
    OR creator_id::text = current_setting('app.current_user_id', TRUE)
  );

-- ---------------------------------------------------------------------------
-- user_notifications
-- ---------------------------------------------------------------------------
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_notifications_isolation ON user_notifications
  FOR ALL
  USING (
    current_setting('app.current_user_id', TRUE) = ''
    OR user_id::text = current_setting('app.current_user_id', TRUE)
  );

-- ---------------------------------------------------------------------------
-- dm_conversations: user can access their own conversations
-- ---------------------------------------------------------------------------
ALTER TABLE dm_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY dm_conversations_isolation ON dm_conversations
  FOR ALL
  USING (
    current_setting('app.current_user_id', TRUE) = ''
    OR user_a_id::text = current_setting('app.current_user_id', TRUE)
    OR user_b_id::text = current_setting('app.current_user_id', TRUE)
  );

-- ---------------------------------------------------------------------------
-- guild_members
-- ---------------------------------------------------------------------------
ALTER TABLE guild_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY guild_members_isolation ON guild_members
  FOR ALL
  USING (
    current_setting('app.current_user_id', TRUE) = ''
    OR user_id::text = current_setting('app.current_user_id', TRUE)
  );

-- Allow any authenticated query to READ public guild membership (left_at IS NULL)
-- when no user context is set — needed for guild discovery pages and CRON.
CREATE POLICY guild_members_read_public ON guild_members
  FOR SELECT
  USING (
    current_setting('app.current_user_id', TRUE) = ''
    AND left_at IS NULL
  );
