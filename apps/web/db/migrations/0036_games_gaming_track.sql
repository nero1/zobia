-- =====================================================================
-- 0036_games_gaming_track.sql
--
-- Gaming leaderboard tab, game favorites ("❤️ Faves"), and challenge
-- lifecycle changes (30-day expiry default, archive completed challenges).
--
-- All statements are idempotent (IF NOT EXISTS) so the migration is safe
-- to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Game favorites — heart-icon toggle on the games discovery page.
--    Mirrors room_pins (0001_consolidated_schema.sql): unlimited, not
--    plan-gated, one row per (user, game).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_favorites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id    UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_game_favorites_user_created
  ON game_favorites (user_id, created_at DESC);

-- Powers the "❤️ N" fave-count meta shown on game cards.
CREATE INDEX IF NOT EXISTS idx_game_favorites_game
  ON game_favorites (game_id);

-- Denormalised counter (mirrors games.play_count / games.rating_count) so the
-- "❤️ 4.7K" meta on the discovery page is a plain column read, not a
-- COUNT(*) subquery per row across the whole games list.
ALTER TABLE games ADD COLUMN IF NOT EXISTS favorite_count integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------
-- 2. Challenge archiving — hide a completed challenge from the default
--    inbox view without touching the wager/prize ledger rows. Either
--    participant can archive their own view (see BUG-CHALLENGE-01 note
--    in lib/games/challenges.ts for why we never delete completed rows).
-- ---------------------------------------------------------------------
ALTER TABLE game_challenges ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_game_challenges_archived
  ON game_challenges (archived_at)
  WHERE archived_at IS NULL;
