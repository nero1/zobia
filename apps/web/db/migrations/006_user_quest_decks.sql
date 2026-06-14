-- 006_user_quest_decks.sql
-- Creates the user_quest_decks table referenced by checkDeckCompletion in questEngine.ts
-- Each row represents a daily deck assignment: one quest per user per date.

CREATE TABLE IF NOT EXISTS user_quest_decks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_id    UUID NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  assigned_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, quest_id, assigned_date)
);

CREATE INDEX IF NOT EXISTS idx_user_quest_decks_user_date
  ON user_quest_decks (user_id, assigned_date);
