-- =============================================================================
-- 038_guild_chat.sql
--
-- Adds the guild chat feature required by PRD §13.
-- "Bronze I–III: Guild chat, profile badge, war eligibility"
-- =============================================================================

CREATE TABLE IF NOT EXISTS guild_messages (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id     UUID        NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  sender_id    UUID        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  content      TEXT        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
  type         TEXT        NOT NULL DEFAULT 'text'
                 CHECK (type IN ('text', 'sticker', 'gif')),
  sticker_id   TEXT,
  gif_url      TEXT,
  is_deleted   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guild_messages_guild_created
  ON guild_messages (guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guild_messages_sender
  ON guild_messages (sender_id);
