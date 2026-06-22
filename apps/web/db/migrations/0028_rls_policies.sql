-- Migration 0028: Row Level Security policies for high-value tables
-- TASK-08 (BUG-SEC-03): Enable RLS on financial, privacy-sensitive, and social tables.
-- Routes can enforce isolation via withRLS() which sets app.current_user_id = current user.
--
-- IMPORTANT: Each table also gets an unrestricted service_role policy so that
-- background CRON jobs, admin routes, and direct DB connections (migrations) are
-- not affected. App-tier queries that need isolation must call withRLS().

-- ---------------------------------------------------------------------------
-- coin_ledger
-- ---------------------------------------------------------------------------
ALTER TABLE coin_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY coin_ledger_own_rows ON coin_ledger
  FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', TRUE));

CREATE POLICY coin_ledger_service_bypass ON coin_ledger
  FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- ---------------------------------------------------------------------------
-- star_ledger
-- ---------------------------------------------------------------------------
ALTER TABLE star_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY star_ledger_own_rows ON star_ledger
  FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', TRUE));

CREATE POLICY star_ledger_service_bypass ON star_ledger
  FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- ---------------------------------------------------------------------------
-- payout_requests
-- ---------------------------------------------------------------------------
ALTER TABLE payout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY payout_requests_own_rows ON payout_requests
  FOR ALL
  USING (creator_id::text = current_setting('app.current_user_id', TRUE));

CREATE POLICY payout_requests_service_bypass ON payout_requests
  FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- ---------------------------------------------------------------------------
-- user_notifications
-- ---------------------------------------------------------------------------
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_notifications_own_rows ON user_notifications
  FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', TRUE));

CREATE POLICY user_notifications_service_bypass ON user_notifications
  FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- ---------------------------------------------------------------------------
-- dm_conversations: user can access their own conversations
-- ---------------------------------------------------------------------------
ALTER TABLE dm_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY dm_conversations_participant ON dm_conversations
  FOR ALL
  USING (
    user_a_id::text = current_setting('app.current_user_id', TRUE)
    OR user_b_id::text = current_setting('app.current_user_id', TRUE)
  );

CREATE POLICY dm_conversations_service_bypass ON dm_conversations
  FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- ---------------------------------------------------------------------------
-- guild_members
-- ---------------------------------------------------------------------------
ALTER TABLE guild_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY guild_members_own_row ON guild_members
  FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', TRUE));

CREATE POLICY guild_members_read_public ON guild_members
  FOR SELECT
  USING (left_at IS NULL);

CREATE POLICY guild_members_service_bypass ON guild_members
  FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);
