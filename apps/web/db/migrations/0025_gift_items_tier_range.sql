-- 0025_gift_items_tier_range.sql
--
-- gift_items.tier was constrained to BETWEEN 1 AND 3 (gift_items_tier_check)
-- but the app (createGiftSchema/updateGiftSchema in
-- app/api/admin/gifts/route.ts and [id]/route.ts, plus the admin gift form
-- and the TIER_LABELS used across the sitewide gifts economy) has always
-- supported 5 tiers: Friendly, Warm, Grand, Epic, Legendary. Widen the
-- CHECK constraint to match, so creating/updating a gift with tier 4 or 5
-- no longer fails with a raw DB constraint-violation error.

ALTER TABLE gift_items DROP CONSTRAINT IF EXISTS gift_items_tier_check;
ALTER TABLE gift_items ADD CONSTRAINT gift_items_tier_check CHECK (tier BETWEEN 1 AND 5);
