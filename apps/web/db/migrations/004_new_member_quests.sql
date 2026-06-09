-- =============================================================================
-- Migration 004: Add new_member_quests table
-- The user_quests table is for template-based daily quests; new member quests
-- are a separate one-time-per-user guided onboarding mission.
-- =============================================================================

CREATE TABLE IF NOT EXISTS new_member_quests (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_type     TEXT NOT NULL DEFAULT 'new_member',
  progress       JSONB NOT NULL DEFAULT '{}',
  completed      BOOLEAN NOT NULL DEFAULT FALSE,
  reward_claimed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, quest_type)
);

CREATE INDEX IF NOT EXISTS new_member_quests_user_id_idx ON new_member_quests(user_id);
