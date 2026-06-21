-- Migration: Bug fix schema changes
-- Addresses: NULLABLE-01, SCHEMA-01, SCHEMA-04, SCHEMA-05, SCHEMA-07, GUILD-01

-- NULLABLE-01: Make is_banned NOT NULL (backfill NULLs first)
UPDATE users SET is_banned = false WHERE is_banned IS NULL;
ALTER TABLE users ALTER COLUMN is_banned SET NOT NULL;
ALTER TABLE users ALTER COLUMN is_banned SET DEFAULT false;

-- SCHEMA-01: Add login_streak_days column if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_streak_days INTEGER DEFAULT 0;

-- SCHEMA-04: Add CHECK constraint for DM conversation ordering (user1 < user2)
-- Only add if the constraint doesn't exist yet
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dm_conversations_user_ordering'
  ) THEN
    ALTER TABLE dm_conversations
      ADD CONSTRAINT dm_conversations_user_ordering
      CHECK (user1_id < user2_id);
  END IF;
END $$;

-- SCHEMA-05: Fix referral_commissions.tier default
ALTER TABLE referral_commissions ALTER COLUMN tier SET DEFAULT '1';

-- SCHEMA-07: Update creator_earnings unique index to include creator_id
DROP INDEX IF EXISTS creator_earnings_reference_id_idx;
CREATE UNIQUE INDEX IF NOT EXISTS creator_earnings_reference_id_idx
  ON creator_earnings (creator_id, reference_id)
  WHERE reference_id IS NOT NULL;

-- GUILD-01: Ensure below_min_since is used as canonical column; drop below_minimum_days if it exists
ALTER TABLE guilds DROP COLUMN IF EXISTS below_minimum_days;

-- SCHEMA-02: Sessions table pruning (if sessions table exists)
-- This is handled by the daily CRON instead of a migration.

-- RACE-01: Add unique constraint to gifts for idempotency
-- The gifts table uses Redis for idempotency; no DB-level unique index needed.

-- SCHEMA-03: Drop deprecated userQuests table (replaced by quest_progress + user_quest_decks)
-- Data should be migrated before running this. The table is kept as a safety backup;
-- uncomment the DROP after confirming all callers have been updated.
-- DROP TABLE IF EXISTS user_quests;

-- Temporary: add comment to signal deprecation without breaking existing reads
COMMENT ON TABLE user_quests IS 'DEPRECATED: replaced by quest_progress + user_quest_decks. Do not use for new features.';
