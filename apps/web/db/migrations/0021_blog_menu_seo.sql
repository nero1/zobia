-- 0021_blog_menu_seo.sql
--
-- Blog navigation menu (owner-configurable) + slug-generation rule change.
--
--   - menu_config (jsonb): { orientation: 'horizontal'|'vertical', items: [...] }.
--     Owner-configurable via dashboard/settings (menu builder). The
--     orientation choice only applies on desktop web — Android and mobile
--     web/PWA always render the menu as a vertical accordion inside the
--     hamburger menu, per product spec, regardless of this setting.
--     ADD COLUMN ... DEFAULT seeds every existing row with the same sane
--     default menu (Home / Categories / Subscribe) as new blogs get at
--     creation time (see lib/blogs/menu.ts's DEFAULT_MENU_CONFIG, which this
--     literal mirrors).
--
-- Slug generation itself (first-6-words rule, slug_redirects on rename) is
-- an application-level change in lib/blogs/service.ts / lib/slug.ts — no
-- schema change needed there since slug_redirects already exists (used by
-- games/rooms renames) and blogs.slug is already just a text column.

ALTER TABLE blogs
  ADD COLUMN IF NOT EXISTS menu_config jsonb NOT NULL DEFAULT '{
    "orientation": "horizontal",
    "items": [
      {"id": "home", "label": "Home", "type": "url", "externalUrl": "/"},
      {"id": "categories", "label": "Categories", "type": "url", "externalUrl": "#categories"},
      {"id": "subscribe", "label": "Subscribe", "type": "url", "externalUrl": "#subscribe"}
    ]
  }'::jsonb;
