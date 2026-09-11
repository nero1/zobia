-- 0040_room_custom_rewards.sql
--
-- Room Custom Rewards: extends the existing generic content_treasuries /
-- content_treasury_claims mechanic (lib/contentTreasury.ts, previously
-- shared by Polls and Quizzes) to Rooms, triggered by a member sending ANY
-- gift to the room owner (rather than voting/passing/sharing).
--
-- A room owner funds/configures ONE active custom reward for their room at a
-- time (same one-per-content-id shape as content_treasuries already has for
-- polls/quizzes — CREATE OR REPLACE via fundContentTreasury's ON CONFLICT
-- upsert). The owner picks a reward_action:
--   - 'credits' / 'stars': fund a pool that the first N distinct gift senders
--     split evenly (same payout mechanic as poll/quiz treasuries).
--   - 'custom_text': no pool — the first N distinct gift senders each get
--     `custom_instructions` shown to them (e.g. "DM me your Discord tag for
--     the VIP role"). funded_amount/remaining_amount are 0 in this mode.
--
-- Distinct from gift_reward_grants (migration 0026), which is the ADMIN-
-- authored sitewide gift catalogue's reward system (a specific gift_items
-- row is marked "rewarded" and grants a badge/privilege to whoever sends
-- it). This migration is the ROOM-OWNER-authored equivalent: the owner
-- defines their own reward, funds it themselves, and it triggers on ANY
-- gift sent to them in that room — the two systems can both be active on
-- the same room send and are independent of each other.

ALTER TABLE content_treasuries DROP CONSTRAINT IF EXISTS content_treasuries_type_check;
ALTER TABLE content_treasuries ADD CONSTRAINT content_treasuries_type_check
  CHECK (content_type = ANY (ARRAY['poll'::text, 'quiz'::text, 'room'::text]));

ALTER TABLE content_treasury_claims DROP CONSTRAINT IF EXISTS content_treasury_claims_type_check;
ALTER TABLE content_treasury_claims ADD CONSTRAINT content_treasury_claims_type_check
  CHECK (claim_type = ANY (ARRAY['vote'::text, 'share'::text, 'pass'::text, 'gift'::text]));

ALTER TABLE content_treasuries
  ADD COLUMN IF NOT EXISTS reward_action text NOT NULL DEFAULT 'credits';
ALTER TABLE content_treasuries DROP CONSTRAINT IF EXISTS content_treasuries_reward_action_check;
ALTER TABLE content_treasuries ADD CONSTRAINT content_treasuries_reward_action_check
  CHECK (reward_action = ANY (ARRAY['credits'::text, 'stars'::text, 'custom_text'::text]));

ALTER TABLE content_treasuries
  ADD COLUMN IF NOT EXISTS custom_instructions text;
ALTER TABLE content_treasuries
  ADD COLUMN IF NOT EXISTS title text;

-- Admin-configurable settings for this feature live in x_manifest (read via
-- lib/manifest — see ZobiaManifest.roomCustomRewards), seeded here so the
-- feature works with sane defaults before an admin ever visits
-- /gate44/config.
INSERT INTO x_manifest (key, value, updated_at) VALUES
  ('feature_room_custom_rewards', 'true', NOW()),
  ('room_custom_rewards_min_owner_level', '1', NOW()),
  ('room_custom_rewards_max_claimants_cap', '500', NOW())
ON CONFLICT (key) DO NOTHING;
