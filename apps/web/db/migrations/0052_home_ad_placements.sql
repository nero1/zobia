-- ---------------------------------------------------------------------------
-- 0052_home_ad_placements.sql
--
-- Ad placements for the redesigned Home Dashboard (platform ad system —
-- AdSense/in-house display, distinct from the "content_boost" native
-- placement seeded in 0051_home_feed.sql, which is for boosted user/business
-- content, not platform ads).
--
--   home_top          — above the notices carousel
--   home_mid           — between the notices carousel and the tab bar
--   home_feed_native   — interleaved every ~5-6 items inside each feed tab
--                        (For You / Trending / Friends / New)
--
-- See db/migrations/0006_ads.sql for the ad_placements table shape.
-- ---------------------------------------------------------------------------

INSERT INTO ad_placements (key, label, size, description, base_cpm_credits, sort_order) VALUES
  ('home_top', 'Home top banner', '300x250', 'Home Dashboard — above the notices carousel', 500, 90),
  ('home_mid', 'Home mid banner', '300x250', 'Home Dashboard — between the notices carousel and the feed tabs', 500, 100),
  ('home_feed_native', 'Home feed native', 'native', 'Home Dashboard — interleaved every ~5-6 items inside each feed tab', 450, 110)
ON CONFLICT (key) DO NOTHING;
