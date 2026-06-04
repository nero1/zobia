-- Migration 015: PRD coverage gap tables
-- Adds:
--   - user_banner_views (banner rotation tracking)
--   - announcement_banner_mode x_manifest key
--   - guild_rooms join table (if not exists)
--   - monthly_plan_bonus coin ledger type

-- user_banner_views — tracks which banners each user has seen for serial rotation
CREATE TABLE IF NOT EXISTS user_banner_views (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banner_id     UUID NOT NULL REFERENCES announcement_banners(id) ON DELETE CASCADE,
  viewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, banner_id)
);
CREATE INDEX IF NOT EXISTS idx_user_banner_views_user ON user_banner_views(user_id);

-- guild_rooms — links guilds to their exclusive rooms
CREATE TABLE IF NOT EXISTS guild_rooms (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id   UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(guild_id, room_id)
);
CREATE INDEX IF NOT EXISTS idx_guild_rooms_room ON guild_rooms(room_id);

-- Set default announcement_banner_mode in x_manifest
INSERT INTO x_manifest (key, value, updated_at)
VALUES ('announcement_banner_mode', 'serial', NOW())
ON CONFLICT (key) DO NOTHING;
