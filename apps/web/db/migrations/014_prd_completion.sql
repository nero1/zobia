-- Migration 014: PRD Completion — missing columns, tables, and store items schema
-- Addresses gaps found in Phase 12 gap analysis.

-- ---------------------------------------------------------------------------
-- 1. users: last_streak_before_break
--    Stores the login streak value just before it was broken.
--    Used by the 3-day re-engagement gate (only notify if former streak >= 5).
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_streak_before_break INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2. users: login_streak_days alias
--    The daily CRON references login_streak_days; the base schema uses login_streak.
--    Add the column if it doesn't exist; if it does, both resolve correctly.
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS login_streak_days INTEGER NOT NULL DEFAULT 0;

-- Sync existing login_streak values into login_streak_days on first run
UPDATE users
SET login_streak_days = login_streak
WHERE login_streak_days = 0 AND login_streak > 0;

-- ---------------------------------------------------------------------------
-- 3. store_items — in-app store catalogue
--    Coin packs, Star packs, and Booster packs available for purchase.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS store_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  description    TEXT,
  item_type      TEXT NOT NULL CHECK (item_type IN ('coin_pack', 'star_pack', 'booster')),
  price_kobo     BIGINT,                    -- NULL for coin-purchased boosters
  currency       TEXT NOT NULL DEFAULT 'NGN',
  coins_cost     INTEGER,                   -- cost in coins for booster packs
  coins_granted  INTEGER,                   -- coins granted (coin_pack items)
  stars_granted  INTEGER,                   -- stars granted (star_pack items)
  bonus_label    TEXT,                      -- e.g. "+20% BONUS"
  is_featured    BOOLEAN NOT NULL DEFAULT false,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  valid_until    TIMESTAMPTZ,               -- NULL = no expiry
  sort_order     INTEGER NOT NULL DEFAULT 0,
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_items_type_active
  ON store_items (item_type, is_active);

-- Seed default coin packs (prices in kobo = 100 kobo per NGN)
INSERT INTO store_items (name, item_type, price_kobo, currency, coins_granted, bonus_label, is_featured, sort_order)
VALUES
  ('Starter Pack',   'coin_pack', 50000,   'NGN', 100,   NULL,        false, 1),
  ('Regular Pack',   'coin_pack', 150000,  'NGN', 350,   NULL,        false, 2),
  ('Big Pack',       'coin_pack', 300000,  'NGN', 800,   '+14% BONUS',true,  3),
  ('Baller Pack',    'coin_pack', 600000,  'NGN', 1800,  '+29% BONUS',false, 4),
  ('Boss Pack',      'coin_pack', 1500000, 'NGN', 5000,  '+67% BONUS',false, 5),
  ('Legend Pack',    'coin_pack', 3000000, 'NGN', 11500, '+92% BONUS',false, 6)
ON CONFLICT DO NOTHING;

-- Seed default star packs
INSERT INTO store_items (name, item_type, price_kobo, currency, stars_granted, bonus_label, is_featured, sort_order)
VALUES
  ('Starter Stars',  'star_pack', 200000,  'NGN', 5,   NULL,        false, 1),
  ('Rising Stars',   'star_pack', 500000,  'NGN', 15,  '+20% BONUS',true,  2),
  ('Star Bundle',    'star_pack', 1000000, 'NGN', 35,  '+40% BONUS',false, 3),
  ('Mega Stars',     'star_pack', 2500000, 'NGN', 100, '+67% BONUS',false, 4)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. users: notification preference columns
--    Granular notification toggles referenced by the settings endpoint.
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notify_new_message    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_friend_request BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_gift_received  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_rank_up        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_war_start      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_season_end     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_announcement   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_all_enabled     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_non_critical    BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 5. password_reset_tokens — one-time tokens for password recovery
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_token_hash
  ON password_reset_tokens (token_hash);

-- ---------------------------------------------------------------------------
-- 6. Feature flag: star purchase enabled
-- ---------------------------------------------------------------------------
INSERT INTO x_manifest (key, value, description, updated_at)
VALUES ('feature_star_purchase_enabled', 'false', 'Enable direct Star purchase via web/mobile store', NOW())
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. leaderboard_rank_snapshots — daily rank snapshot for ripple notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leaderboard_rank_snapshots (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope      TEXT NOT NULL DEFAULT 'global',
  rank       INTEGER NOT NULL,
  xp         BIGINT NOT NULL DEFAULT 0,
  snapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, scope)
);
