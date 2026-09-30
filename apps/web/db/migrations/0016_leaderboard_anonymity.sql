-- Migration 0016: hide-my-name-from-leaderboards (paid privacy feature)
--
-- Adds users.hide_from_leaderboards (default false = visible) and the three
-- admin-editable x_manifest keys that govern it (Admin > Config > "Privacy"):
--   leaderboard_anonymity_enabled   master switch
--   leaderboard_anonymity_min_level account level that unlocks it irrespective of plan (0 = off)
--   leaderboard_anonymity_eligible  plan/role eligibility list (all paid plans + business by default)
--
-- No new table, so no GRANT statements are needed (users and x_manifest keep
-- their existing Data API grants; a new column inherits the table grant).

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS hide_from_leaderboards boolean NOT NULL DEFAULT false;

INSERT INTO x_manifest (key, value, description) VALUES
  ('leaderboard_anonymity_enabled', 'true', 'Master switch for the "hide my name from public leaderboards" privacy setting (Plus and above). When off, nobody is hidden and the setting is not offered.'),
  ('leaderboard_anonymity_min_level', '0', 'Account level (main rank number, 1 = Beginner) that unlocks hiding from leaderboards irrespective of plan. 0 disables the level unlock. Combined with leaderboard_anonymity_eligible by OR.'),
  ('leaderboard_anonymity_eligible', '["plus","pro","max","business_starter","business_growth","business_enterprise"]', 'JSON array of plan/role eligibility entries (lib/plans/eligibility.ts vocabulary: plan slugs, prestige_N, business_<tier>, role_admin, role_moderator) allowed to hide from leaderboards. Default: every paid plan and business account.')
ON CONFLICT (key) DO NOTHING;

COMMIT;
