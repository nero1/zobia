-- Migration 0020: Schema cleanup
-- Addresses: BUG-PU-01, BUG-SC-01, BUG-SC-02, BUG-SC-03

-- BUG-PU-01: Add device_id to user_push_tokens for per-device token deduplication
ALTER TABLE user_push_tokens
  ADD COLUMN IF NOT EXISTS device_id VARCHAR(255);

-- BUG-SC-01: Drop sessions table — all auth sessions are stored in Redis.
-- The DB sessions table was never populated in production.
DROP TABLE IF EXISTS sessions;

-- BUG-SC-02: Drop deprecated user_quests table.
-- Replaced by user_quest_progress + quest_templates. All callers now use the new tables.
DROP TABLE IF EXISTS user_quests;

-- BUG-SC-03: Drop unused audit columns from xp_ledger.
-- These columns (action, xp_amount, xp_net, multiplier, description,
-- ceremony_room_id, metadata) are defined in the schema but never populated
-- by any code path. Dropping them reduces row size and prevents confusion.
ALTER TABLE xp_ledger
  DROP COLUMN IF EXISTS action,
  DROP COLUMN IF EXISTS xp_amount,
  DROP COLUMN IF EXISTS xp_net,
  DROP COLUMN IF EXISTS multiplier,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS ceremony_room_id,
  DROP COLUMN IF EXISTS metadata;
