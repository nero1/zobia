-- Migration 0011: sitewide search ad placements
--
-- Registers the ad_placements rows the new sitewide search results page
-- (GET /api/search, /search) uses via the existing <AdSlot placement="..."/>
-- component (components/ads/AdSlot.tsx) — no new ad infrastructure, just new
-- placement keys plugged into the existing plan-gated ad-serving system
-- (lib/ads/serve.ts / GET /api/ads/serve). Manageable afterwards from
-- /gate44/ads like every other placement.
--
-- ad_placements already has anon/authenticated/service_role grants from its
-- creation in 0001_consolidated_schema.sql, so no GRANT statements are
-- needed here (only brand-new tables require them).

BEGIN;

INSERT INTO ad_placements (key, label, size, description, is_active, sort_order) VALUES
  ('search_top', 'Search — top banner', '320x50', 'Shown above sitewide search results.', true, 100),
  ('search_after_3', 'Search — after 3rd result', 'native', 'Shown after the 3rd sitewide search result.', true, 101),
  ('search_after_8', 'Search — after 8th result', 'native', 'Shown after the 8th sitewide search result.', true, 102),
  ('search_bottom', 'Search — bottom banner', '320x50', 'Shown below the last loaded sitewide search result.', true, 103)
ON CONFLICT (key) DO NOTHING;

COMMIT;
