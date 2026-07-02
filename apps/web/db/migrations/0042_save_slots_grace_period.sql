-- Migration 0042: Save Slots + Subscription Grace Period
--
-- Two related features:
--
-- 1. Save Slots — lets a user pause an in-progress game and resume it later.
--    Slot count is plan-gated (Free 0 / Plus 1 / Pro 3 / Max 5 by default,
--    admin-configurable via x_manifest `save_slots_<plan>` keys). Enforced
--    in application code (lib/games/saves.ts) since the limit is dynamic
--    per-plan, not a fixed DB constraint.
--
-- 2. Subscription Grace Period — when a personal or business subscription
--    lapses (does not renew), the account is downgraded immediately, but a
--    default grace period (admin-configurable per plan/tier, in days) keeps
--    admin-selected data (e.g. saved games) from being purged. The
--    `daily-economy` CRON sweeps `subscriptions`/`business_accounts` rows
--    past `ends_at` into `status = 'grace'` (setting `grace_period_ends_at`),
--    then sweeps rows past `grace_period_ends_at` into `status = 'lapsed'`
--    and purges any grace-gated data (see lib/plans/gracePeriod.ts and
--    lib/games/saves.ts `purgeSavesForUser`).
--
-- The set of "what counts as grace-gated" is an extensible registry
-- (lib/plans/graceFeatures.ts) so new features (e.g. the future Image
-- Galleries) can opt in without a new migration — only new x_manifest keys.

CREATE TABLE IF NOT EXISTS game_saves (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id    UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  label      TEXT,
  state      JSONB NOT NULL,
  score      INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_saves_user_updated
  ON game_saves (user_id, updated_at DESC);

ALTER TABLE game_saves ENABLE ROW LEVEL SECURITY;

CREATE POLICY game_saves_isolation ON game_saves
  FOR ALL
  USING (
    current_setting('app.current_user_id', TRUE) = ''
    OR user_id::text = current_setting('app.current_user_id', TRUE)
  );

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ;

ALTER TABLE business_accounts
  ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ;

-- Per-plan save slot counts (personal plans only — free has none).
INSERT INTO x_manifest (key, value, description) VALUES
  ('save_slots_free', '0', 'Save slots for Free plan users (in-progress game saves).'),
  ('save_slots_plus', '1', 'Save slots for Plus plan users.'),
  ('save_slots_pro',  '3', 'Save slots for Pro plan users.'),
  ('save_slots_max',  '5', 'Save slots for Max plan users.')
ON CONFLICT (key) DO NOTHING;

-- Per-plan / per-business-tier grace period length (days) after a
-- subscription lapses, before grace-gated data is purged.
INSERT INTO x_manifest (key, value, description) VALUES
  ('grace_period_days_plus', '7',  'Grace period (days) after a Plus subscription lapses before grace-gated data is purged.'),
  ('grace_period_days_pro',  '14', 'Grace period (days) after a Pro subscription lapses before grace-gated data is purged.'),
  ('grace_period_days_max',  '30', 'Grace period (days) after a Max subscription lapses before grace-gated data is purged.'),
  ('grace_period_days_business_starter',    '7',  'Grace period (days) after a Business Starter subscription lapses.'),
  ('grace_period_days_business_growth',     '14', 'Grace period (days) after a Business Growth subscription lapses.'),
  ('grace_period_days_business_enterprise', '30', 'Grace period (days) after a Business Enterprise subscription lapses.')
ON CONFLICT (key) DO NOTHING;

-- Per-plan / per-business-tier list of grace-gated feature keys (JSON array
-- of keys from lib/plans/graceFeatures.ts) preserved during the grace
-- period. Admin-editable at /admin/config (Grace Periods & Save Slots group).
INSERT INTO x_manifest (key, value, description) VALUES
  ('grace_period_features_plus', '["saved_games"]', 'Grace-gated features preserved during the Plus grace period.'),
  ('grace_period_features_pro',  '["saved_games"]', 'Grace-gated features preserved during the Pro grace period.'),
  ('grace_period_features_max',  '["saved_games"]', 'Grace-gated features preserved during the Max grace period.'),
  ('grace_period_features_business_starter',    '["saved_games"]', 'Grace-gated features preserved during the Business Starter grace period.'),
  ('grace_period_features_business_growth',     '["saved_games"]', 'Grace-gated features preserved during the Business Growth grace period.'),
  ('grace_period_features_business_enterprise', '["saved_games"]', 'Grace-gated features preserved during the Business Enterprise grace period.')
ON CONFLICT (key) DO NOTHING;
