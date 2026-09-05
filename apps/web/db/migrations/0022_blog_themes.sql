-- 0022_blog_themes.sql
--
-- Blog theme engine, phase 2: structural themes (not just color skins).
--
-- The existing mechanism (migration 0002) treats a blog theme as a bare
-- store_items row (item_type='cosmetic', cosmetic_type='blog_theme') with no
-- concept of a structural layout, plan-gating, or admin-editable pricing —
-- just a name/description/coins_cost and a metadata.themeKey the UI never
-- actually reads. That's kept (theme_store_item_id, user_cosmetics, the
-- generic /api/economy/cosmetics(+/equip) endpoints) as the underlying
-- purchase/ownership ledger for themes that must be bought, but the actual
-- catalog/entitlement source of truth moves to this new `blog_themes` table
-- so admin has one clean place to toggle enabled/pricing/plan-gating per
-- theme, and so free-default and plan-included themes (which need no
-- store_items row/purchase at all) can be represented too.
--
-- id is a short stable text key (not a uuid) since these are a small,
-- fixed, code-defined catalog (see lib/blogs/themes.ts) — the DB row here
-- only carries the *admin-editable* facts (enabled/gating/pricing); the
-- structural layout_variant + visual config are seeded here but the actual
-- React layout components live in code, keyed by layout_variant.

CREATE TABLE IF NOT EXISTS blog_themes (
    id text PRIMARY KEY,
    name text NOT NULL,
    description text,
    layout_variant text NOT NULL,
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

-- Seed catalog: 2 free-default + 3 plan-gated/purchasable themes spanning
-- 4 structurally distinct layout variants (classic, magazine, minimal-cards,
-- sidebar-left). Editorial/Noir/Botanical map onto the pre-existing
-- store_items rows seeded in 0002 (matched here by name) so any coins
-- already spent/owned via the old /api/economy/cosmetics flow keep working
-- as the ownership check for these themes' credits purchase path.
INSERT INTO blog_themes (id, name, description, layout_variant, config, included_for_plans, included_for_business_tiers, is_free_default, store_item_id, credits_cost, stars_cost, enabled, sort_order) VALUES
  ('classic', 'Classic', 'The original single-column layout — clean and familiar.', 'classic',
    '{"bg":"#0a0a0a","card":"#171717","accent":"#14b8a6","text":"#fafafa","muted":"#a3a3a3"}'::jsonb,
    '{}', '{}', true, NULL, NULL, NULL, true, 1),
  ('minimal', 'Minimal Cards', 'A compact card grid with less metadata per post — quiet and fast to scan.', 'minimal-cards',
    '{"bg":"#0a0a0a","card":"#171717","accent":"#e5e5e5","text":"#fafafa","muted":"#a3a3a3"}'::jsonb,
    '{}', '{}', true, NULL, NULL, NULL, true, 2),
  ('editorial', 'Editorial', 'A magazine-style layout: a featured-post hero above a grid of post cards.', 'magazine',
    '{"bg":"#0a0a0a","card":"#171717","accent":"#1f2937","text":"#fafafa","muted":"#a3a3a3"}'::jsonb,
    ARRAY['pro','max'], ARRAY['growth','enterprise'], false,
    (SELECT id FROM store_items WHERE name = 'Editorial' AND cosmetic_type = 'blog_theme' LIMIT 1), 500, NULL, true, 3),
  ('sidebar', 'Noir Sidebar', 'A moody dark theme with a left sidebar of categories and recent posts.', 'sidebar-left',
    '{"bg":"#000000","card":"#111111","accent":"#f59e0b","text":"#fafafa","muted":"#8a8a8a"}'::jsonb,
    ARRAY['max'], ARRAY['enterprise'], false,
    (SELECT id FROM store_items WHERE name = 'Noir' AND cosmetic_type = 'blog_theme' LIMIT 1), 800, NULL, true, 4),
  ('botanical', 'Botanical', 'A warm, airy card grid with soft greens — friendly for lifestyle blogs.', 'minimal-cards',
    '{"bg":"#0c1210","card":"#132018","accent":"#059669","text":"#f0fdf4","muted":"#86a893"}'::jsonb,
    '{}', '{}', false,
    (SELECT id FROM store_items WHERE name = 'Botanical' AND cosmetic_type = 'blog_theme' LIMIT 1), 1200, NULL, true, 5)
ON CONFLICT (id) DO NOTHING;

-- blogs.active_theme_id — which blog_themes row is currently applied. Must
-- come AFTER the seed INSERT above: an ADD COLUMN ... DEFAULT 'classic'
-- REFERENCES blog_themes(id) backfills every existing blogs row's new
-- column with 'classic' as part of this same statement, and that backfill
-- is FK-checked immediately — 'classic' has to already exist in
-- blog_themes by the time this runs, not merely by end of transaction.
-- theme_store_item_id (0002) is left in place for the old purchase ledger
-- (user_cosmetics.store_item_id) but is no longer read for rendering.
ALTER TABLE blogs
  ADD COLUMN IF NOT EXISTS active_theme_id text NOT NULL DEFAULT 'classic' REFERENCES blog_themes(id);

-- Backfill: any blog that already had an old theme_store_item_id equipped
-- picks up the matching new blog_themes row so existing purchases still
-- render as the (structurally distinct) theme the owner picked.
UPDATE blogs b
SET active_theme_id = bt.id
FROM blog_themes bt
WHERE b.theme_store_item_id IS NOT NULL
  AND bt.store_item_id = b.theme_store_item_id
  AND b.active_theme_id = 'classic';
