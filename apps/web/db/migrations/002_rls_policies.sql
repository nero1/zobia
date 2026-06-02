-- ============================================================
-- Zobia Social — Migration 002: Row Level Security Policies
--
-- The application sets the current user via:
--   SET LOCAL app.current_user_id = '<uuid>';
-- within every transaction that touches user data.
--
-- Service-role operations (background workers, admin panel)
-- bypass RLS by connecting as the service role, or by using
-- the SECURITY DEFINER functions that wrap privileged writes.
-- ============================================================

-- Enable RLS on every user-facing table
ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_ledger            ENABLE ROW LEVEL SECURITY;
ALTER TABLE star_ledger            ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_ledger              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships            ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows                ENABLE ROW LEVEL SECURITY;
ALTER TABLE guilds                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_wars             ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages               ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_chats            ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_chat_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_quests            ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons                ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_passes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE nemesis_assignments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports                ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_earnings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_payouts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE gifts                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_modals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_banners   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_modal_views       ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_message_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE x_manifest             ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- users
-- Every user profile is publicly readable (username, display
-- name, rank, etc.).  Only the owner may update their own row.
-- ============================================================
CREATE POLICY users_select_public ON users
  FOR SELECT USING (true);

CREATE POLICY users_update_own ON users
  FOR UPDATE USING (id::text = current_setting('app.current_user_id', true));

-- INSERT is handled by the service role (registration flow).

-- ============================================================
-- coin_ledger — append-only
-- Users can read their own ledger.  The service role inserts.
-- No UPDATE or DELETE policies → those operations are denied.
-- ============================================================
CREATE POLICY coin_ledger_select_own ON coin_ledger
  FOR SELECT USING (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY coin_ledger_insert_service ON coin_ledger
  FOR INSERT WITH CHECK (true);  -- service role executes inserts

-- ============================================================
-- star_ledger — same pattern as coin_ledger
-- ============================================================
CREATE POLICY star_ledger_select_own ON star_ledger
  FOR SELECT USING (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY star_ledger_insert_service ON star_ledger
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- xp_ledger — read own, service inserts
-- ============================================================
CREATE POLICY xp_ledger_select_own ON xp_ledger
  FOR SELECT USING (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY xp_ledger_insert_service ON xp_ledger
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- sessions — users manage only their own sessions
-- ============================================================
CREATE POLICY sessions_own ON sessions
  FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));

-- ============================================================
-- friendships — visible to either party in the relationship
-- ============================================================
CREATE POLICY friendships_own ON friendships
  FOR SELECT USING (
    requester_id::text = current_setting('app.current_user_id', true) OR
    addressee_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY friendships_insert ON friendships
  FOR INSERT WITH CHECK (
    requester_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY friendships_update_own ON friendships
  FOR UPDATE USING (
    requester_id::text = current_setting('app.current_user_id', true) OR
    addressee_id::text = current_setting('app.current_user_id', true)
  );

-- ============================================================
-- follows — public read; users manage their own follows
-- ============================================================
CREATE POLICY follows_select ON follows
  FOR SELECT USING (true);

CREATE POLICY follows_insert ON follows
  FOR INSERT WITH CHECK (
    follower_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY follows_delete ON follows
  FOR DELETE USING (
    follower_id::text = current_setting('app.current_user_id', true)
  );

-- ============================================================
-- guilds — public discovery; captain manages their guild
-- ============================================================
CREATE POLICY guilds_select ON guilds
  FOR SELECT USING (true);

CREATE POLICY guilds_insert ON guilds
  FOR INSERT WITH CHECK (
    captain_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY guilds_update_captain ON guilds
  FOR UPDATE USING (
    captain_id::text = current_setting('app.current_user_id', true)
  );

-- ============================================================
-- guild_members — readable by members of the same guild
-- ============================================================
CREATE POLICY guild_members_select ON guild_members
  FOR SELECT USING (
    -- visible to the member themselves
    user_id::text = current_setting('app.current_user_id', true)
    OR
    -- visible to other members of the same guild
    guild_id IN (
      SELECT guild_id FROM guild_members
      WHERE user_id::text = current_setting('app.current_user_id', true)
    )
  );

CREATE POLICY guild_members_insert_service ON guild_members
  FOR INSERT WITH CHECK (true);  -- join flow is service-managed

CREATE POLICY guild_members_update_service ON guild_members
  FOR UPDATE USING (true);

CREATE POLICY guild_members_delete_service ON guild_members
  FOR DELETE USING (true);

-- ============================================================
-- guild_wars — public read (war scores are public info)
-- ============================================================
CREATE POLICY guild_wars_select ON guild_wars
  FOR SELECT USING (true);

CREATE POLICY guild_wars_insert_service ON guild_wars
  FOR INSERT WITH CHECK (true);

CREATE POLICY guild_wars_update_service ON guild_wars
  FOR UPDATE USING (true);

-- ============================================================
-- rooms — public rooms readable by all; private rooms readable
-- by creator and members only
-- ============================================================
CREATE POLICY rooms_select ON rooms
  FOR SELECT USING (
    is_public = true
    OR creator_id::text = current_setting('app.current_user_id', true)
    OR id IN (
      SELECT room_id FROM room_members
      WHERE user_id::text = current_setting('app.current_user_id', true)
    )
  );

CREATE POLICY rooms_insert ON rooms
  FOR INSERT WITH CHECK (
    creator_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY rooms_update_creator ON rooms
  FOR UPDATE USING (
    creator_id::text = current_setting('app.current_user_id', true)
  );

-- ============================================================
-- room_members — visible to all members of the same room
-- ============================================================
CREATE POLICY room_members_select ON room_members
  FOR SELECT USING (
    room_id IN (
      SELECT room_id FROM room_members
      WHERE user_id::text = current_setting('app.current_user_id', true)
    )
  );

CREATE POLICY room_members_insert_service ON room_members
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- group_chats — visible to members only
-- ============================================================
CREATE POLICY group_chats_select ON group_chats
  FOR SELECT USING (
    id IN (
      SELECT group_chat_id FROM group_chat_members
      WHERE user_id::text = current_setting('app.current_user_id', true)
    )
  );

CREATE POLICY group_chats_insert ON group_chats
  FOR INSERT WITH CHECK (
    creator_id::text = current_setting('app.current_user_id', true)
  );

-- ============================================================
-- group_chat_members
-- ============================================================
CREATE POLICY group_chat_members_select ON group_chat_members
  FOR SELECT USING (
    group_chat_id IN (
      SELECT group_chat_id FROM group_chat_members
      WHERE user_id::text = current_setting('app.current_user_id', true)
    )
  );

CREATE POLICY group_chat_members_insert_service ON group_chat_members
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- messages — DMs visible to both parties; room messages visible
-- to room members; group chat messages visible to members
-- ============================================================
CREATE POLICY messages_dm_select ON messages
  FOR SELECT USING (
    -- DMs: sender or recipient
    (recipient_id IS NOT NULL AND (
      sender_id::text = current_setting('app.current_user_id', true) OR
      recipient_id::text = current_setting('app.current_user_id', true)
    ))
    OR
    -- Room messages: room member or public room
    (room_id IS NOT NULL AND (
      room_id IN (SELECT id FROM rooms WHERE is_public = true)
      OR room_id IN (
        SELECT room_id FROM room_members
        WHERE user_id::text = current_setting('app.current_user_id', true)
      )
    ))
    OR
    -- Group chat messages: group member
    (group_chat_id IS NOT NULL AND (
      group_chat_id IN (
        SELECT group_chat_id FROM group_chat_members
        WHERE user_id::text = current_setting('app.current_user_id', true)
      )
    ))
  );

CREATE POLICY messages_insert ON messages
  FOR INSERT WITH CHECK (
    sender_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY messages_update_own ON messages
  FOR UPDATE USING (
    sender_id::text = current_setting('app.current_user_id', true)
  );

-- ============================================================
-- message_reactions
-- ============================================================
CREATE POLICY message_reactions_select ON message_reactions
  FOR SELECT USING (true);   -- reactions are public

CREATE POLICY message_reactions_insert ON message_reactions
  FOR INSERT WITH CHECK (
    user_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY message_reactions_delete ON message_reactions
  FOR DELETE USING (
    user_id::text = current_setting('app.current_user_id', true)
  );

-- ============================================================
-- user_quests — users see and manage only their own
-- ============================================================
CREATE POLICY quests_own ON user_quests
  FOR ALL USING (
    user_id::text = current_setting('app.current_user_id', true)
  );

-- ============================================================
-- seasons — publicly readable
-- ============================================================
CREATE POLICY seasons_select ON seasons
  FOR SELECT USING (true);

-- ============================================================
-- season_passes — users see only their own
-- ============================================================
CREATE POLICY season_passes_own ON season_passes
  FOR SELECT USING (
    user_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY season_passes_insert_service ON season_passes
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- nemesis_assignments — users see only their own assignment
-- ============================================================
CREATE POLICY nemesis_own ON nemesis_assignments
  FOR SELECT USING (
    user_id::text = current_setting('app.current_user_id', true)
  );

-- ============================================================
-- reports — users can file and view their own reports
-- ============================================================
CREATE POLICY reports_insert ON reports
  FOR INSERT WITH CHECK (
    reporter_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY reports_select_own ON reports
  FOR SELECT USING (
    reporter_id::text = current_setting('app.current_user_id', true)
  );

-- ============================================================
-- payments — users see only their own payment records
-- ============================================================
CREATE POLICY payments_own ON payments
  FOR SELECT USING (
    user_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY payments_insert_service ON payments
  FOR INSERT WITH CHECK (true);

CREATE POLICY payments_update_service ON payments
  FOR UPDATE USING (true);

-- ============================================================
-- creator_earnings — creators see only their own
-- ============================================================
CREATE POLICY earnings_own ON creator_earnings
  FOR SELECT USING (
    creator_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY earnings_insert_service ON creator_earnings
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- creator_payouts — creators see only their own
-- ============================================================
CREATE POLICY payouts_own ON creator_payouts
  FOR SELECT USING (
    creator_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY payouts_insert_own ON creator_payouts
  FOR INSERT WITH CHECK (
    creator_id::text = current_setting('app.current_user_id', true)
  );

-- ============================================================
-- gift_items — public catalogue
-- ============================================================
CREATE POLICY gift_items_select ON gift_items
  FOR SELECT USING (true);

-- ============================================================
-- gifts — visible to sender and recipient
-- ============================================================
CREATE POLICY gifts_own ON gifts
  FOR SELECT USING (
    sender_id::text = current_setting('app.current_user_id', true) OR
    recipient_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY gifts_insert_service ON gifts
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- announcement_modals / banners — readable by all;
-- filtering (by plan, role, date) happens in application layer
-- ============================================================
CREATE POLICY modals_select ON announcement_modals
  FOR SELECT USING (true);

CREATE POLICY banners_select ON announcement_banners
  FOR SELECT USING (true);

-- ============================================================
-- user_modal_views
-- ============================================================
CREATE POLICY modal_views_own ON user_modal_views
  FOR ALL USING (
    user_id::text = current_setting('app.current_user_id', true)
  );

-- ============================================================
-- admin_messages — admin inserts only; users cannot see the
-- message body directly, only via their own receipt
-- ============================================================
CREATE POLICY admin_messages_insert_service ON admin_messages
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- admin_message_receipts — users see only their own receipts
-- ============================================================
CREATE POLICY admin_msg_receipts_own ON admin_message_receipts
  FOR SELECT USING (
    user_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY admin_msg_receipts_update_own ON admin_message_receipts
  FOR UPDATE USING (
    user_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY admin_msg_receipts_insert_service ON admin_message_receipts
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- subscriptions — users see only their own
-- ============================================================
CREATE POLICY subscriptions_own ON subscriptions
  FOR SELECT USING (
    user_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY subscriptions_insert_service ON subscriptions
  FOR INSERT WITH CHECK (true);

CREATE POLICY subscriptions_update_service ON subscriptions
  FOR UPDATE USING (true);

-- ============================================================
-- referrals — users see referrals they made or received
-- ============================================================
CREATE POLICY referrals_own ON referrals
  FOR SELECT USING (
    referrer_id::text = current_setting('app.current_user_id', true) OR
    referred_id::text = current_setting('app.current_user_id', true)
  );

CREATE POLICY referrals_insert_service ON referrals
  FOR INSERT WITH CHECK (true);

CREATE POLICY referrals_update_service ON referrals
  FOR UPDATE USING (true);

-- ============================================================
-- x_manifest — publicly readable at runtime;
-- writes are service/admin role only (no user policy)
-- ============================================================
CREATE POLICY manifest_select ON x_manifest
  FOR SELECT USING (true);
