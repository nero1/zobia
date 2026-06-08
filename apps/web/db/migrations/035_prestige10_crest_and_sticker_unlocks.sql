-- Migration 035: Prestige 10 Custom Crest & DM Sticker Unlock Tracking
--
-- 1. users.custom_crest   — stores Hall of Fame user's custom crest (emoji or URL)
-- 2. dm_score_sticker_unlocks — tracks which DM sticker packs a pair has unlocked
--    (referenced in lib/messaging/conversationScore.ts §5 PRD)

-- ---------------------------------------------------------------------------
-- 1. Custom crest for Hall of Fame users (PRD §9)
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS custom_crest TEXT CHECK (char_length(custom_crest) <= 500);

-- ---------------------------------------------------------------------------
-- 2. DM score sticker unlock tracking (PRD §5)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dm_score_sticker_unlocks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id_1   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_2   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_name   TEXT        NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id_1, user_id_2, pack_name)
);

CREATE INDEX IF NOT EXISTS idx_dm_sticker_unlocks_pair
  ON dm_score_sticker_unlocks (user_id_1, user_id_2);
