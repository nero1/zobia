-- 0024_blog_gifts.sql
--
-- Rewarded Gifts: a blog subscriber/reader can send an owner-defined "gift"
-- to unlock a benefit for themselves. Owners define tiers per blog:
--   - vip_badge:          buyer gets a badge next to their name in that
--                         blog's comments while the purchase is active.
--   - vip_section_access: buyer gets the same kind of unlock a paywalled
--                         post grants (reuses blog_post_unlocks).
--   - custom_reward:      owner-authored reward — a payout from a
--                         blog-level treasury (first X redeemers) and/or a
--                         text blob revealed after purchase.
--
-- Blog-level treasury: rather than duplicate blog_post_treasuries, we make
-- post_id nullable there and add blog_id — a NULL post_id + non-null blog_id
-- row is a blog-level pot (funds a custom_reward gift tier); the existing
-- per-post pot keeps post_id set (blog_id backfilled for consistency, still
-- used by claimTreasuryReward/fundPostTreasury unchanged for posts).

ALTER TABLE blog_post_treasuries
  ALTER COLUMN post_id DROP NOT NULL;
ALTER TABLE blog_post_treasuries
  ADD COLUMN IF NOT EXISTS blog_id uuid REFERENCES blogs(id) ON DELETE CASCADE;
ALTER TABLE blog_post_treasuries
  ADD COLUMN IF NOT EXISTS gift_tier_id uuid;
-- Blog-level gift pots don't use the "first N claimants" mechanic (the cap
-- lives on blog_gift_tiers.max_redemptions instead) so max_claimants is
-- meaningless there; relax it to nullable for that row shape only.
ALTER TABLE blog_post_treasuries
  ALTER COLUMN max_claimants DROP NOT NULL;

UPDATE blog_post_treasuries t
  SET blog_id = p.blog_id
  FROM blog_posts p
  WHERE t.post_id = p.id AND t.blog_id IS NULL;

-- A blog-level pot (post_id IS NULL) is unique per gift tier; a post-level
-- pot keeps its existing one-per-post uniqueness (index already created by
-- migration 0020 as blog_post_treasuries_post_idx, which naturally excludes
-- NULLs so it still works unchanged for post-level rows).
CREATE UNIQUE INDEX IF NOT EXISTS blog_post_treasuries_gift_tier_idx
  ON blog_post_treasuries (gift_tier_id) WHERE gift_tier_id IS NOT NULL;

ALTER TABLE blog_post_treasuries
  DROP CONSTRAINT IF EXISTS blog_post_treasuries_scope_check;
ALTER TABLE blog_post_treasuries
  ADD CONSTRAINT blog_post_treasuries_scope_check
  CHECK (
    (post_id IS NOT NULL AND gift_tier_id IS NULL) OR
    (post_id IS NULL AND gift_tier_id IS NOT NULL AND blog_id IS NOT NULL)
  );

CREATE TABLE IF NOT EXISTS blog_gift_tiers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  blog_id uuid NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  credits_price integer,
  stars_price integer,
  benefit_type text NOT NULL,
  -- vip_section_access: { "unlockPostId": uuid } (post-level unlock granted on purchase)
  -- custom_reward:      { "treasuryAmount": int, "maxRedemptions": int, "textInstructions": string }
  benefit_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  max_redemptions integer,
  redemption_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS blog_gift_tiers_blog_idx ON blog_gift_tiers (blog_id);

ALTER TABLE blog_gift_tiers
  DROP CONSTRAINT IF EXISTS blog_gift_tiers_benefit_type_check;
ALTER TABLE blog_gift_tiers
  ADD CONSTRAINT blog_gift_tiers_benefit_type_check
  CHECK (benefit_type = ANY (ARRAY['vip_badge'::text, 'vip_section_access'::text, 'custom_reward'::text]));

ALTER TABLE blog_gift_tiers
  DROP CONSTRAINT IF EXISTS blog_gift_tiers_price_check;
ALTER TABLE blog_gift_tiers
  ADD CONSTRAINT blog_gift_tiers_price_check
  CHECK (credits_price IS NOT NULL OR stars_price IS NOT NULL);

-- Now that the tier table exists, wire the FK the treasury table referenced above.
ALTER TABLE blog_post_treasuries
  DROP CONSTRAINT IF EXISTS blog_post_treasuries_gift_tier_fk;
ALTER TABLE blog_post_treasuries
  ADD CONSTRAINT blog_post_treasuries_gift_tier_fk
  FOREIGN KEY (gift_tier_id) REFERENCES blog_gift_tiers(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS blog_gift_purchases (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tier_id uuid NOT NULL REFERENCES blog_gift_tiers(id) ON DELETE CASCADE,
  blog_id uuid NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency text NOT NULL,
  amount_paid integer NOT NULL,
  benefit_type text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS blog_gift_purchases_tier_idx ON blog_gift_purchases (tier_id);
CREATE INDEX IF NOT EXISTS blog_gift_purchases_buyer_idx ON blog_gift_purchases (buyer_id);
-- One active VIP badge per (blog, buyer) via a partial unique index scoped to the badge benefit type.
CREATE UNIQUE INDEX IF NOT EXISTS blog_gift_purchases_vip_badge_idx
  ON blog_gift_purchases (blog_id, buyer_id) WHERE benefit_type = 'vip_badge' AND status = 'active';

ALTER TABLE blog_gift_purchases
  DROP CONSTRAINT IF EXISTS blog_gift_purchases_currency_check;
ALTER TABLE blog_gift_purchases
  ADD CONSTRAINT blog_gift_purchases_currency_check CHECK (currency = ANY (ARRAY['credits'::text, 'stars'::text]));

-- Tracks fulfillment of a custom_reward tier's text-unlock reveal + the
-- (separately tracked) treasury payout, one row per purchase.
CREATE TABLE IF NOT EXISTS blog_gift_claims (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_id uuid NOT NULL REFERENCES blog_gift_purchases(id) ON DELETE CASCADE,
  treasury_payout_amount integer,
  text_revealed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS blog_gift_claims_purchase_idx ON blog_gift_claims (purchase_id);

-- Manifest defaults for the new feature flags / kill-switch (idempotent seed;
-- an admin who already set these keeps their value).
INSERT INTO x_manifest (key, value)
  VALUES ('feature_blog_gifts', 'true')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO x_manifest (key, value)
  VALUES ('blog_monetization_enabled', 'true')
  ON CONFLICT (key) DO NOTHING;
