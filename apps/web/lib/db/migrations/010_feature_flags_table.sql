-- Migration 010: Feature Flags Table + Schema Fixes (BUG-ADMIN-03, BUG-DRIZZLE-01)

-- BUG-DRIZZLE-01: Add next_renewal_at to user_subscriptions
-- The Paystack webhook writes to this column but it was missing from the
-- initial migration 009 CREATE TABLE definition.
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS next_renewal_at TIMESTAMPTZ;

-- SEC-01: Add pre_auth_session to users for 2FA flow state tracking.
-- Stores the active pre-auth JWT so it can be explicitly cleared from the DB
-- after successful 2FA verification (defence-in-depth alongside Redis TTL).
ALTER TABLE users ADD COLUMN IF NOT EXISTS pre_auth_session TEXT;
--
-- Creates the `feature_flags` table referenced by /api/admin/feature-flags.
-- This table stores extended metadata (early-access windows, plan gates) for
-- feature flags whose toggle state is stored in x_manifest.

CREATE TABLE IF NOT EXISTS feature_flags (
  key                TEXT PRIMARY KEY,
  available_from     TIMESTAMPTZ,
  early_access_plans TEXT[],
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for plan-gated lookups (find all flags available to a given plan)
CREATE INDEX IF NOT EXISTS idx_feature_flags_early_access_plans
  ON feature_flags USING GIN (early_access_plans);

-- Ensure x_manifest has all standard feature flags seeded (idempotent)
INSERT INTO x_manifest (key, value, description, updated_at)
VALUES
  ('feature_guild_wars',           'true',  'Enable Guild Wars feature',           NOW()),
  ('feature_mystery_xp_drops',     'true',  'Enable Mystery XP Drop events',       NOW()),
  ('feature_alliance_wars',        'true',  'Enable National Alliance Wars',       NOW()),
  ('feature_creator_fund',         'true',  'Enable Creator Fund distributions',   NOW()),
  ('feature_leaderboard_seasons',  'true',  'Enable seasonal leaderboard mode',    NOW()),
  ('feature_telegram_integration', 'false', 'Enable Telegram notification channel',NOW()),
  ('feature_sentry_tracing',       'false', 'Enable Sentry performance tracing',   NOW())
ON CONFLICT (key) DO NOTHING;
