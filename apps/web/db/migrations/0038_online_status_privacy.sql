-- 0038_online_status_privacy.sql
--
-- Adds an opt-in "show my online status" privacy toggle, gated to Pro/Max
-- plans (and Prestige 1+) like the other privacy toggles added in the
-- users.profile_private / disable_friend_requests migration.
--
-- Default FALSE: users must explicitly opt in before their presence is
-- surfaced to friends on the Home page "Online Friends" row. This also fixes
-- the "friends always show even if offline" bug — GET /api/friends/online
-- now filters to actually-online (or recently-active) friends who opted in.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS show_online_status BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO x_manifest (key, value, description) VALUES
  ('privacy_can_show_online_status', '["pro","max","prestige_1"]',
   'Plans/prestige tiers allowed to toggle "show my online status" in privacy settings')
ON CONFLICT (key) DO NOTHING;
