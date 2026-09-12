-- 0050_market_referrals_boosts_themes.sql
--
-- Unified "Market" feature batch:
--   1. merch_products — per-listing referral program opt-in (digital +
--      physical) and admin/creator promotion flags (sponsored, admin
--      featured) that the new Market page reads to build its sections.
--   2. merch_product_reviews — minimal 1-5 star rating so the Market page
--      can sort creator items by rating (previously no rating concept
--      existed anywhere for merch products).
--   3. referral_commissions — tag rows with their source (coin purchase vs.
--      creator merch item) and, for merch rows, the originating order, so
--      merch referral payouts show up in a seller/referrer's existing
--      commission stats without a parallel ledger.
--   4. profile_themes — mirrors blog_themes (migration 0022) exactly: a
--      small admin-editable catalog of profile color skins, backed by the
--      existing store_items/user_cosmetics purchase ledger for paid themes.
--   5. boost_types — moves the previously hardcoded BOOSTER_CONFIG map in
--      app/api/economy/boosters/route.ts into an admin-manageable catalog
--      so admin can add new boost types from gate44 without a code deploy.
--      Seeded with the 5 existing hardcoded types so behavior is unchanged
--      until an admin adds more.
--   6. x_manifest — default config for the new referral-commission and
--      Market rotation knobs, all admin-editable via existing manifest UI.
--   7. quest_templates — one new always-eligible daily quest tracking a
--      Market purchase (action_type 'market_purchase').
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. merch_products — referral + promotion flags
-- ---------------------------------------------------------------------------

ALTER TABLE merch_products ADD COLUMN IF NOT EXISTS referral_enabled boolean NOT NULL DEFAULT false;
-- Only meaningful for product_type = 'physical' (digital items use the
-- platform-wide tier1/tier2 commission rates in x_manifest instead — see
-- lib/referrals/commissions.ts). Minimum enforced at the application layer
-- (1.00) and again here as a defensive DB constraint.
ALTER TABLE merch_products ADD COLUMN IF NOT EXISTS referral_commission_pct numeric(5,2);
ALTER TABLE merch_products ADD COLUMN IF NOT EXISTS is_sponsored boolean NOT NULL DEFAULT false;
ALTER TABLE merch_products ADD COLUMN IF NOT EXISTS sponsored_until timestamp with time zone;
ALTER TABLE merch_products ADD COLUMN IF NOT EXISTS is_admin_featured boolean NOT NULL DEFAULT false;

ALTER TABLE merch_products
  ADD CONSTRAINT merch_products_referral_pct_min
  CHECK (referral_commission_pct IS NULL OR referral_commission_pct >= 1.00);

CREATE INDEX IF NOT EXISTS idx_merch_products_sponsored ON merch_products (is_sponsored) WHERE is_sponsored = true;
CREATE INDEX IF NOT EXISTS idx_merch_products_admin_featured ON merch_products (is_admin_featured) WHERE is_admin_featured = true;
CREATE INDEX IF NOT EXISTS idx_merch_products_market_listing ON merch_products (is_active, product_type) WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- 2. merch_product_reviews — verified-purchase 1-5 star rating
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS merch_product_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES merch_products(id) ON DELETE CASCADE,
    buyer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id uuid REFERENCES merch_orders(id) ON DELETE SET NULL,
    rating smallint NOT NULL,
    comment text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT merch_product_reviews_rating_range CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT merch_product_reviews_one_per_buyer UNIQUE (product_id, buyer_id)
);

CREATE INDEX IF NOT EXISTS idx_merch_product_reviews_product ON merch_product_reviews (product_id);

-- ---------------------------------------------------------------------------
-- 3. referral_commissions — source tagging for merch item commissions
-- ---------------------------------------------------------------------------

ALTER TABLE referral_commissions ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'coin_purchase';
-- 'coin_purchase' | 'merch_digital' | 'merch_physical'
ALTER TABLE referral_commissions ADD COLUMN IF NOT EXISTS reference_order_id uuid REFERENCES merch_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_referral_commissions_source_type ON referral_commissions (source_type);

-- ---------------------------------------------------------------------------
-- 4. profile_themes — mirrors blog_themes (migration 0022)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS profile_themes (
    id text PRIMARY KEY,
    name text NOT NULL,
    description text,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    included_for_plans text[] NOT NULL DEFAULT '{}',
    included_for_business_tiers text[] NOT NULL DEFAULT '{}',
    is_free_default boolean NOT NULL DEFAULT false,
    store_item_id uuid REFERENCES store_items(id) ON DELETE SET NULL,
    credits_cost integer,
    stars_cost integer,
    enabled boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Paid themes need a store_items row for the shared cosmetics/Credits ledger
-- (user_cosmetics), exactly like a purchasable blog theme (migration 0002).
INSERT INTO store_items (name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, sort_order, metadata) VALUES
  ('Midnight Profile Theme', 'A deep-blue profile skin with cool accents.', 'cosmetic', 0, 'NGN', 500, NULL, NULL, NULL, 'profile_theme', NULL, false, true, false, 60, '{"themeKey":"midnight"}'),
  ('Sunset Profile Theme', 'A warm orange/pink profile skin.', 'cosmetic', 0, 'NGN', 800, NULL, NULL, NULL, 'profile_theme', NULL, false, true, false, 61, '{"themeKey":"sunset"}'),
  ('Emerald Profile Theme', 'A rich green profile skin with gold highlights.', 'cosmetic', 0, 'NGN', 1200, NULL, NULL, NULL, 'profile_theme', NULL, false, true, false, 62, '{"themeKey":"emerald"}')
ON CONFLICT (name) DO NOTHING;

INSERT INTO profile_themes (id, name, description, config, included_for_plans, included_for_business_tiers, is_free_default, store_item_id, credits_cost, stars_cost, enabled, sort_order) VALUES
  ('classic', 'Classic', 'The original Zobia profile look.', '{"bg":"#0a0a0a","card":"#171717","accent":"#14b8a6","text":"#fafafa","muted":"#a3a3a3"}'::jsonb, '{}', '{}', true, NULL, NULL, NULL, true, 1),
  ('midnight', 'Midnight', 'A deep-blue skin with cool accents.', '{"bg":"#050912","card":"#0f1a2e","accent":"#3b82f6","text":"#f1f5f9","muted":"#93a3b8"}'::jsonb, ARRAY['plus','pro','max'], ARRAY['growth','enterprise'], false,
    (SELECT id FROM store_items WHERE name = 'Midnight Profile Theme' LIMIT 1), 500, NULL, true, 2),
  ('sunset', 'Sunset', 'Warm oranges and pinks for a bold profile.', '{"bg":"#1a0f0a","card":"#2a1810","accent":"#f97316","text":"#fef3e2","muted":"#c9a68c"}'::jsonb, ARRAY['pro','max'], ARRAY['growth','enterprise'], false,
    (SELECT id FROM store_items WHERE name = 'Sunset Profile Theme' LIMIT 1), 800, NULL, true, 3),
  ('emerald', 'Emerald', 'A rich green skin with gold highlights.', '{"bg":"#06120c","card":"#0e2018","accent":"#10b981","text":"#ecfdf5","muted":"#8fb8a5"}'::jsonb, ARRAY['max'], ARRAY['enterprise'], false,
    (SELECT id FROM store_items WHERE name = 'Emerald Profile Theme' LIMIT 1), 1200, NULL, true, 4)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_profile_theme_id text NOT NULL DEFAULT 'classic' REFERENCES profile_themes(id);

-- ---------------------------------------------------------------------------
-- 5. boost_types — admin-manageable boost/multiplier catalog
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS boost_types (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Stable key matched against user_xp_boosters.booster_type and, for the
    -- 5 seeded rows, the historical hardcoded values in
    -- app/api/economy/boosters/route.ts — new admin-created types get a
    -- slug-style key of the admin's choosing.
    key text NOT NULL UNIQUE,
    label text NOT NULL,
    description text,
    -- Basis points: 100 = 1.0x, 200 = 2.0x. 0 for non-multiplier boosts
    -- (premium_send / premium_send_7day are entitlement flags, not XP mults).
    multiplier_bp integer NOT NULL DEFAULT 0,
    duration_hours integer NOT NULL,
    coins_cost integer,
    stars_cost integer,
    -- Google Play product ID an admin must also create in Play Console for
    -- this boost to be purchasable via IAP on the Capacitor Android app —
    -- see docs/HOW-IT-WORKS.md "Boosts & Play Billing".
    iap_product_id text,
    -- Most boost types block re-purchase while one is already active
    -- (see app/api/economy/boosters/route.ts); a one-shot consumable like
    -- Premium Send is the exception and may stack.
    stackable boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT boost_types_duration_positive CHECK (duration_hours > 0)
);

INSERT INTO boost_types (key, label, description, multiplier_bp, duration_hours, coins_cost, stackable, sort_order) VALUES
  ('xp_booster', 'XP Booster', '2x XP for 24 hours.', 200, 24, 200, false, 1),
  ('quest_accelerator', 'Quest Accelerator', '1.5x XP for 7 days.', 150, 24 * 7, 800, false, 2),
  ('guild_war_boost', 'Guild War Boost', '2x XP for the current Guild War (up to 30 days).', 200, 24 * 30, 1500, false, 3),
  ('premium_send', 'Premium Send', 'One premium message send.', 0, 24 * 365, 50, true, 4),
  ('premium_send_7day', 'Premium Send Pass', '7-day premium send subscription.', 0, 24 * 7, 300, false, 5)
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_boost_types_active ON boost_types (is_active) WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- 6. x_manifest — Market referral + rotation defaults
-- ---------------------------------------------------------------------------

INSERT INTO x_manifest (key, value, description) VALUES
  ('market_referral_digital_enabled', 'true', 'Admin kill switch: allow creators to opt digital Market items into the referral program (uses the standard tier1/tier2 commission rates).'),
  ('market_referral_physical_enabled', 'true', 'Admin kill switch: allow creators to opt physical Market items into the referral program (creator-set commission %, platform keeps its standard cut of that %).'),
  ('market_referral_physical_min_pct', '1.00', 'Minimum referral commission % a creator may set on a physical item (of which the platform fee % below is taken first).'),
  ('market_referral_platform_fee_pct', '20', 'Platform''s cut of a physical item''s referral commission pool, taken before the remainder goes to the referrer. Mirrors the merch creator/platform 80/20 split.'),
  ('market_trending_boost_weight', '2.0', 'Multiplier applied to a creator item''s selection weight in the Market "Trending" section rotation once it crosses the trending threshold below.'),
  ('market_trending_min_orders', '5', 'Minimum completed orders in the last 14 days for a creator item to be eligible for the Market trending-item rotation boost.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. quest_templates — daily "visit the Market and buy something" quest
-- ---------------------------------------------------------------------------

INSERT INTO quest_templates (title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon, is_active) VALUES
  ('Market Run', 'Visit the Market and buy something — any item counts.', 'market_purchase', 1, 60, 20, 'explorer', 'free', 'economy', 'shopping-bag', true)
ON CONFLICT (title) DO NOTHING;
