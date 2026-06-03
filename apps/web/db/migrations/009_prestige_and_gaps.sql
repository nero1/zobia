-- Migration 009: Prestige cycle boost, inactivity event notified flag,
--               guild contribution tracking, and misc PRD gaps.

-- 1. Prestige cycle XP boost expiry (3× XP for first 7 days after each prestige)
ALTER TABLE users ADD COLUMN IF NOT EXISTS prestige_cycle_boost_expires_at TIMESTAMPTZ;

-- 2. user_inactivity_events.notified column (for re-engagement CRON idempotency)
CREATE TABLE IF NOT EXISTS user_inactivity_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inactive_days INTEGER NOT NULL,
  notified     BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, inactive_days, created_at)
);

-- Add notified column if table already exists without it
ALTER TABLE user_inactivity_events ADD COLUMN IF NOT EXISTS notified BOOLEAN NOT NULL DEFAULT false;

-- 3. Guild contribution score snapshot table (for 2-week rolling alert)
CREATE TABLE IF NOT EXISTS guild_contribution_alerts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id   UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weeks_below INTEGER NOT NULL DEFAULT 1,
  alerted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(guild_id, user_id)
);

-- 4. Hall of Fame table for Prestige 10 users
CREATE TABLE IF NOT EXISTS hall_of_fame (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inducted_at    TIMESTAMPTZ DEFAULT NOW(),
  prestige_count INTEGER NOT NULL,
  legacy_score   BIGINT NOT NULL DEFAULT 0,
  UNIQUE(user_id)
);

-- 5. Mystery XP Drop tracking (prevent double-drops within 24h)
--    Already handled via xp_ledger action='mystery_drop' + created_at check,
--    so no new table needed. Add a feature flag for the drop.

-- 6. Vibe quiz room personalization seed categories
--    Column already added in migration 008 (users.onboarding_personalization).
--    No new table needed.

-- 7. DM conversation score sticker unlock milestone flag
--    dm_score_sticker_unlocks already created in migration 008.
--    Add explicit milestone tracking column.
CREATE TABLE IF NOT EXISTS dm_conversation_score_milestones (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id_a       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_b       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  milestone_score INTEGER NOT NULL,
  awarded_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id_a, user_id_b, milestone_score)
);

-- 8. moderation_reports — the canonical reports table used by all API routes.
--    The legacy 'reports' table from migration 001 remains but new code uses this.
CREATE TABLE IF NOT EXISTS moderation_reports (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  reported_message_id UUID,
  reported_room_id    UUID REFERENCES rooms(id) ON DELETE SET NULL,
  reported_guild_id   UUID REFERENCES guilds(id) ON DELETE SET NULL,
  report_type         TEXT NOT NULL DEFAULT 'other',
  description         TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  ai_category         TEXT,
  ai_confidence       DECIMAL(5,4),
  ai_recommendation   TEXT,
  ai_provider         TEXT,
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note     TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_reports_reporter   ON moderation_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_reported   ON moderation_reports(reported_user_id) WHERE reported_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_moderation_reports_status     ON moderation_reports(status, created_at DESC);

-- 9. Standardise user_badges schema.
--    Original schema used badge_type + reference_id + awarded_at.
--    New code (prestige, track milestones, CRON) uses badge_key + metadata + granted_at.
--    This migration adds the new columns (keeping old ones for backwards compat),
--    back-fills badge_key from badge_type where null, and adds the UNIQUE constraint
--    used by ON CONFLICT (user_id, badge_key) clauses.
ALTER TABLE user_badges ADD COLUMN IF NOT EXISTS badge_key  TEXT;
ALTER TABLE user_badges ADD COLUMN IF NOT EXISTS granted_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE user_badges ADD COLUMN IF NOT EXISTS metadata   JSONB;

-- Back-fill badge_key from badge_type for existing rows
UPDATE user_badges SET badge_key = badge_type WHERE badge_key IS NULL AND badge_type IS NOT NULL;

-- Create the unique index used by ON CONFLICT (user_id, badge_key) clauses.
-- Partial index excludes rows where badge_key is NULL (legacy rows).
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_badges_key ON user_badges(user_id, badge_key)
  WHERE badge_key IS NOT NULL;

-- 10. Room Powers — Message Pin, Room Spotlight, Member Highlight (PRD §11)

-- Rename original 'messages' table to 'room_messages' to match all API route references.
-- This is a one-time rename; IF NOT EXISTS guard prevents double-execution.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages' AND table_schema = 'public')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'room_messages' AND table_schema = 'public')
  THEN
    ALTER TABLE messages RENAME TO room_messages;
  END IF;
END$$;

--     Message Pin: marks a room message as pinned (visible at top)
ALTER TABLE room_messages ADD COLUMN IF NOT EXISTS is_pinned      BOOLEAN DEFAULT false;
ALTER TABLE room_messages ADD COLUMN IF NOT EXISTS pinned_at      TIMESTAMPTZ;
ALTER TABLE room_messages ADD COLUMN IF NOT EXISTS pinned_by      UUID REFERENCES users(id) ON DELETE SET NULL;

--     Room Spotlight: temporary discovery boost purchased with coins
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS spotlight_until        TIMESTAMPTZ;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS spotlight_by           UUID REFERENCES users(id) ON DELETE SET NULL;

--     Member Highlight: temporarily highlights a member in their room
CREATE TABLE IF NOT EXISTS room_member_highlights (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id      UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  highlighted_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_member_highlights_room ON room_member_highlights(room_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_rooms_spotlight ON rooms(spotlight_until) WHERE spotlight_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_room_messages_pinned ON room_messages(room_id) WHERE is_pinned = true;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_prestige_boost ON users(prestige_cycle_boost_expires_at)
  WHERE prestige_cycle_boost_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_inactivity_notified ON user_inactivity_events(notified, created_at)
  WHERE notified = false;
CREATE INDEX IF NOT EXISTS idx_guild_contribution_alerts_guild ON guild_contribution_alerts(guild_id);
CREATE INDEX IF NOT EXISTS idx_hall_of_fame_user ON hall_of_fame(user_id);
CREATE INDEX IF NOT EXISTS idx_dm_score_milestones ON dm_conversation_score_milestones(user_id_a, user_id_b);

-- Feature flag for mystery drops
INSERT INTO x_manifest (key, value, description) VALUES
  ('feature_mystery_xp_drops',    'true', 'Enable randomised Mystery XP Drop events'),
  ('mystery_drop_batch_size',     '50',   'Number of users to receive each Mystery XP Drop'),
  ('mystery_drop_days_per_week',  '3',    'How many days per week mystery drops fire (1-7)')
ON CONFLICT (key) DO NOTHING;
