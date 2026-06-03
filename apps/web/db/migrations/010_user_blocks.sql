-- Migration 010: User block list, DM privacy, and missing schema columns (PRD §3, §7, §14, §18)

-- ============================================================
-- 1. user_blocks — bilateral block list
-- ============================================================
-- When user A blocks user B:
--   - B cannot send DMs to A
--   - Any pending friendship between A and B is cancelled
--   - B's messages in A's feed are filtered client-side
CREATE TABLE IF NOT EXISTS user_blocks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(blocker_id, blocked_id),
  CHECK(blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

-- ============================================================
-- 2. DM privacy and soft-delete columns on users
-- ============================================================

-- dm_privacy: controls who can send the user DMs
ALTER TABLE users ADD COLUMN IF NOT EXISTS dm_privacy TEXT NOT NULL DEFAULT 'everyone'
  CHECK(dm_privacy IN ('everyone', 'friends_only', 'nobody'));

-- deleted_at: soft-delete timestamp — rows with non-NULL deleted_at are invisible to
-- normal queries. All user queries use WHERE deleted_at IS NULL.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- ============================================================
-- 3. Creator payout columns on users
-- ============================================================
-- These columns are read by /api/creator/payouts and /api/creator/kyc.

-- Gross earnings available for payout (in kobo). Incremented by webhook on gift/subscription
-- received; decremented when payout is requested.
ALTER TABLE users ADD COLUMN IF NOT EXISTS available_earnings_kobo BIGINT NOT NULL DEFAULT 0;

-- Paystack or DodoPayments recipient code (set after KYC / bank-account confirmation).
ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_recipient_code TEXT;

-- Last 4 digits of the creator's bank account (display only, never full account number).
ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_account_last4 TEXT;

-- ============================================================
-- 4. gifts table — add status column and coin_cost alias
-- ============================================================
-- The gifts/send route inserts 'coin_cost' and 'status'.
-- Original schema only has 'coin_value'. Add both missing columns.

ALTER TABLE gifts ADD COLUMN IF NOT EXISTS coin_cost INTEGER;
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS status    TEXT NOT NULL DEFAULT 'delivered'
  CHECK(status IN ('delivered', 'failed', 'refunded'));

-- Back-fill coin_cost from coin_value for existing rows
UPDATE gifts SET coin_cost = coin_value WHERE coin_cost IS NULL;

-- Make coin_cost NOT NULL after back-fill
ALTER TABLE gifts ALTER COLUMN coin_cost SET NOT NULL;

-- ============================================================
-- 5. creator_payouts table (required by /api/creator/payouts)
-- ============================================================
CREATE TABLE IF NOT EXISTS creator_payouts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gross_kobo          BIGINT NOT NULL,
  net_kobo            BIGINT NOT NULL,
  platform_fee_kobo   BIGINT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'awaiting_approval', 'processing', 'completed', 'failed', 'reversed')),
  provider_reference  TEXT,
  provider_status     TEXT,
  bank_account_last4  TEXT,
  idempotency_key     TEXT NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  UNIQUE(idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_creator_payouts_creator ON creator_payouts(creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_payouts_status  ON creator_payouts(status) WHERE status NOT IN ('completed', 'failed');

-- ============================================================
-- 6. Room message reactions (PRD §11 — custom reaction sets)
-- ============================================================
CREATE TABLE IF NOT EXISTS room_message_reactions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_room_msg_reactions_msg  ON room_message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_room_msg_reactions_user ON room_message_reactions(user_id);

-- ============================================================
-- 7. user_titles — earned titles from prestige, seasons, track milestones
-- ============================================================
-- Referenced by season pass milestone claim, prestige route, and track milestones.
CREATE TABLE IF NOT EXISTS user_titles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  source      TEXT,          -- 'prestige' | 'season_pass' | 'track_milestone' | 'admin'
  is_active   BOOLEAN NOT NULL DEFAULT false,  -- only one title can be displayed at a time
  awarded_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, title)
);

CREATE INDEX IF NOT EXISTS idx_user_titles_user ON user_titles(user_id);

-- ============================================================
-- 8. learning_certificates — issued by Knowledge Track L25+ creators
-- ============================================================
-- Referenced by /api/classroom/[roomId]/certificate route.
CREATE TABLE IF NOT EXISTS learning_certificates (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  student_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issuer_id         UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  issued_at         TIMESTAMPTZ DEFAULT NOW(),
  certificate_url   TEXT,
  metadata          JSONB,
  UNIQUE(classroom_room_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_learning_certs_student ON learning_certificates(student_id);
CREATE INDEX IF NOT EXISTS idx_learning_certs_room    ON learning_certificates(classroom_room_id);

-- ============================================================
-- 9. xp_events — audit log for individual XP award events
-- ============================================================
-- Referenced by gifts/send, coins/transfer, reactions, and other routes
-- but never defined in any migration. Distinct from xp_ledger (which is
-- the financial-style append-only ledger) — this table is the event log.
CREATE TABLE IF NOT EXISTS xp_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  xp_awarded INTEGER NOT NULL,
  track      TEXT NOT NULL DEFAULT 'main',
  metadata   JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_xp_events_user       ON xp_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_xp_events_action     ON xp_events(action);
CREATE INDEX IF NOT EXISTS idx_xp_events_user_action ON xp_events(user_id, action);

-- ============================================================
-- 10. user_notifications — in-app notification inbox for users
-- ============================================================
-- Used by elder route, nemesis route, stickers, cron/daily, and many others.
-- Some routes use (user_id, type, payload) and others use
-- (user_id, type, title, body, metadata). Both variants are supported.
CREATE TABLE IF NOT EXISTS user_notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT,
  body       TEXT,
  payload    JSONB,
  metadata   JSONB,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user    ON user_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_unread  ON user_notifications(user_id) WHERE is_read = false;

-- ============================================================
-- 11. user_messages — inbox messages (admin broadcasts, creator broadcasts)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content      TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'direct'
    CHECK(message_type IN ('direct', 'broadcast', 'admin', 'system')),
  reference_id UUID,
  is_read      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_messages_recipient ON user_messages(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_messages_unread    ON user_messages(recipient_id) WHERE is_read = false;

-- ============================================================
-- 12. rank_up_events — audit log for rank tier transitions
-- ============================================================
CREATE TABLE IF NOT EXISTS rank_up_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank_from  TEXT NOT NULL,
  rank_to    TEXT NOT NULL,
  xp_at_event BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rank_up_events_user ON rank_up_events(user_id, created_at DESC);

-- ============================================================
-- 13. admin_actions — log of moderation actions taken by admins
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_actions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  reason          TEXT,
  duration_hours  INTEGER,
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_admin  ON admin_actions(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_user_id) WHERE target_user_id IS NOT NULL;

-- ============================================================
-- 14. admin_audit_log — log of admin config / setting changes
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  resource    TEXT,
  resource_id TEXT,
  before_val  JSONB,
  after_val   JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin ON admin_audit_log(admin_id, created_at DESC);

-- ============================================================
-- 15. user_season_milestone_claims — tracks which pass milestones have been claimed
-- ============================================================
CREATE TABLE IF NOT EXISTS user_season_milestone_claims (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id    UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  milestone_id UUID NOT NULL,
  claimed_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, season_id, milestone_id)
);

CREATE INDEX IF NOT EXISTS idx_season_milestone_claims ON user_season_milestone_claims(user_id, season_id);

-- ============================================================
-- 16. DM reply limit tightening — update x_manifest defaults
-- ============================================================
-- Free: 25 replies/day, Plus: 50 replies/day (PRD §3 table)
INSERT INTO x_manifest (key, value, description) VALUES
  ('dm_reply_limit_free', '25', 'Max DM replies per day for Free plan'),
  ('dm_reply_limit_plus', '50', 'Max DM replies per day for Plus plan')
ON CONFLICT (key) DO NOTHING;
