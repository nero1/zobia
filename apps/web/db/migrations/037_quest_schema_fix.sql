-- =============================================================================
-- 037_quest_schema_fix.sql
--
-- Fixes the column name mismatch between quest_templates schema and the
-- questEngine / daily quest API routes.
--
-- questEngine.ts and app/api/quests/daily/ query columns that don't exist:
--   action_type   → was named quest_type
--   target_count  → was named target_value
--   plan_required → was named min_plan
--   category      → didn't exist
--   icon          → didn't exist
-- =============================================================================

-- Rename quest_type → action_type
ALTER TABLE quest_templates
  RENAME COLUMN quest_type TO action_type;

-- Rename target_value → target_count
ALTER TABLE quest_templates
  RENAME COLUMN target_value TO target_count;

-- Rename min_plan → plan_required
ALTER TABLE quest_templates
  RENAME COLUMN min_plan TO plan_required;

-- Add missing columns
ALTER TABLE quest_templates
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS icon     TEXT;

-- Update existing seed rows with sensible categories and icons
UPDATE quest_templates SET category = 'social',     icon = '💬' WHERE action_type = 'messages';
UPDATE quest_templates SET category = 'explorer',   icon = '🚪' WHERE action_type = 'room_join';
UPDATE quest_templates SET category = 'generosity', icon = '🎁' WHERE action_type = 'gift';
UPDATE quest_templates SET category = 'social',     icon = '👋' WHERE action_type = 'friend_add';
UPDATE quest_templates SET category = 'creator',    icon = '🎙️' WHERE action_type = 'host_room';
UPDATE quest_templates SET category = 'general',    icon = '⭐' WHERE icon IS NULL;
