-- 0041_profile_stats.sql
--
-- User Profile Stats page (PRD §15): a per-user stats hub showing badges,
-- levels, achievements, created rooms, leaderboard positions, and social
-- counts (friends/followers/referrals) in one place. Visible only to the
-- profile owner and to moderators/admins.
--
-- Admin-configurable like the other privacy/eligibility toggles added in
-- migrations 0008/0038:
--   feature_profile_stats      — master on/off switch (shown automatically
--                                 in the Feature Flags admin panel because it
--                                 matches the `feature_%` prefix).
--   profile_stats_full_plans   — plans/prestige tiers that get the "full"
--                                 stats view (detailed leaderboard positions
--                                 + season history). Everyone else gets the
--                                 "basic" stats view. Default: paid plans
--                                 (free users get basic).

INSERT INTO x_manifest (key, value, description) VALUES
  ('feature_profile_stats', 'true',
   'Master toggle for the User Profile Stats page'),
  ('profile_stats_full_plans', '["plus","pro","max"]',
   'Plans/prestige tiers that get the Full Stats page; everyone else gets the Basic Stats page')
ON CONFLICT (key) DO NOTHING;
