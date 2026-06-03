-- ============================================================
-- Migration 004: Zobia Moments — ephemeral 24-hour content
-- ============================================================

CREATE TABLE IF NOT EXISTS moments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id),
  content      TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text'
                 CHECK (content_type IN ('text','image','video')),
  media_url    TEXT,
  thumbnail_url TEXT,
  caption      TEXT,
  view_count   INTEGER NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moments_user ON moments(user_id);
CREATE INDEX IF NOT EXISTS idx_moments_expires ON moments(expires_at);

CREATE TABLE IF NOT EXISTS moment_views (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  moment_id  UUID NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  viewer_id  UUID NOT NULL REFERENCES users(id),
  viewed_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(moment_id, viewer_id)
);

CREATE TABLE IF NOT EXISTS moment_reactions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  moment_id  UUID NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id),
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(moment_id, user_id)
);
