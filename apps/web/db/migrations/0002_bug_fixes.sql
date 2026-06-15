-- Migration 0002: Bug fixes for BUG-02, BUG-12, BUG-13, BUG-15, BUG-16, BUG-17, BUG-20
-- Run in a transaction. Take a full DB backup before applying.

BEGIN;

-- BUG-02: Add unique constraint on subscriptions.user_id so ON CONFLICT upserts work.
-- Check for duplicates first: SELECT user_id, COUNT(*) FROM subscriptions GROUP BY user_id HAVING COUNT(*) > 1
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_idx ON subscriptions (user_id);

-- BUG-15: Widen star_balance from integer (max 2.1B) to bigint (max ~9.2e18).
ALTER TABLE users ALTER COLUMN star_balance TYPE bigint;

-- BUG-13: Consolidate userBadges dual-timestamp columns.
-- Backfill awarded_at from granted_at where awarded_at is missing.
UPDATE user_badges SET awarded_at = granted_at WHERE awarded_at IS NULL AND granted_at IS NOT NULL;
-- Drop the legacy column.
ALTER TABLE user_badges DROP COLUMN IF EXISTS granted_at;

-- BUG-12: Remove learningCertificates legacy duplicate columns and fix unique index.
-- Backfill canonical columns from legacy columns where canonical is null.
UPDATE learning_certificates
  SET room_id = classroom_room_id
  WHERE room_id IS NULL AND classroom_room_id IS NOT NULL;
UPDATE learning_certificates
  SET recipient_user_id = student_id
  WHERE recipient_user_id IS NULL AND student_id IS NOT NULL;
UPDATE learning_certificates
  SET issuer_user_id = issuer_id
  WHERE issuer_user_id IS NULL AND issuer_id IS NOT NULL;
-- Drop the old unique index on legacy columns.
DROP INDEX IF EXISTS learning_certificates_room_student_idx;
-- Create new unique index on canonical columns.
CREATE UNIQUE INDEX IF NOT EXISTS learning_certificates_room_recipient_idx
  ON learning_certificates (room_id, recipient_user_id);
-- Drop legacy columns.
ALTER TABLE learning_certificates DROP COLUMN IF EXISTS classroom_room_id;
ALTER TABLE learning_certificates DROP COLUMN IF EXISTS student_id;
ALTER TABLE learning_certificates DROP COLUMN IF EXISTS issuer_id;

-- BUG-16: Consolidate moderationActions duplicate columns.
-- Backfill canonical columns from legacy columns where canonical is null.
UPDATE moderation_actions SET moderator_id = actioned_by WHERE moderator_id IS NULL AND actioned_by IS NOT NULL;
UPDATE moderation_actions SET action_type  = action      WHERE action_type  IS NULL AND action      IS NOT NULL;
UPDATE moderation_actions SET reason       = note        WHERE reason       IS NULL AND note        IS NOT NULL;
-- Drop legacy columns.
ALTER TABLE moderation_actions DROP COLUMN IF EXISTS actioned_by;
ALTER TABLE moderation_actions DROP COLUMN IF EXISTS action;
ALTER TABLE moderation_actions DROP COLUMN IF EXISTS note;

-- BUG-17: Remove sponsoredQuests dual reward coin columns.
-- Backfill canonical column from legacy column where canonical is null.
UPDATE sponsored_quests SET reward_coins = reward_amount_coins WHERE reward_coins IS NULL AND reward_amount_coins IS NOT NULL;
-- Drop legacy column.
ALTER TABLE sponsored_quests DROP COLUMN IF EXISTS reward_amount_coins;

-- BUG-20: Remove giftItems dual coin price columns.
-- Backfill canonical coinCost from coinPrice where coinCost is 0 and coinPrice is not.
UPDATE gift_items SET coin_cost = coin_price WHERE coin_cost = 0 AND coin_price IS NOT NULL AND coin_price > 0;
-- Drop legacy column.
ALTER TABLE gift_items DROP COLUMN IF EXISTS coin_price;

COMMIT;
