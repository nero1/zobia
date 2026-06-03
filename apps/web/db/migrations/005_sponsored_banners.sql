-- ============================================================
-- Migration 005: Sponsored Leaderboard Banners + supporting tables
-- ============================================================

-- ============================================================
-- notifications — in-app notification inbox per user
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  payload    JSONB,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id    ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_type  ON notifications(user_id, type);

-- ============================================================
-- conversation_scores — DM pair engagement score + badge state
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_scores (
  user_id_1           UUID NOT NULL REFERENCES users(id),
  user_id_2           UUID NOT NULL REFERENCES users(id),
  score               INTEGER NOT NULL DEFAULT 0,
  streak_days         INTEGER NOT NULL DEFAULT 0,
  has_connection_badge BOOLEAN NOT NULL DEFAULT false,
  badge_unlocked_at   TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id_1, user_id_2),
  CONSTRAINT cs_ordered_pair CHECK (user_id_1 < user_id_2)
);

CREATE INDEX IF NOT EXISTS idx_conversation_scores_u1 ON conversation_scores(user_id_1);
CREATE INDEX IF NOT EXISTS idx_conversation_scores_u2 ON conversation_scores(user_id_2);

-- ============================================================
-- sponsored_leaderboard_banners
-- ============================================================
CREATE TABLE IF NOT EXISTS sponsored_leaderboard_banners (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_name     TEXT NOT NULL,
  sponsor_logo_url TEXT,
  cta_text         TEXT NOT NULL,
  cta_url          TEXT NOT NULL,
  starts_at        TIMESTAMPTZ NOT NULL,
  ends_at          TIMESTAMPTZ NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT false,
  impressions      INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sponsored_banners_active
  ON sponsored_leaderboard_banners(is_active, starts_at, ends_at);
