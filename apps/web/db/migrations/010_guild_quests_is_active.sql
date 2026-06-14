-- 010_guild_quests_is_active.sql
-- Adds is_active column to guild_quests so the CRON can soft-expire old quests
-- without deleting them. Active quests have is_active = TRUE (BUG-GW01 fix).

ALTER TABLE guild_quests
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Back-fill: mark completed quests from past weeks as inactive
UPDATE guild_quests
  SET is_active = FALSE
  WHERE is_completed = TRUE
     OR (week_end IS NOT NULL AND week_end < CURRENT_DATE);

CREATE INDEX IF NOT EXISTS idx_guild_quests_active
  ON guild_quests (guild_id, is_active)
  WHERE is_active = TRUE;
