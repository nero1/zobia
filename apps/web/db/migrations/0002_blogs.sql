-- 0002_blogs.sql
--
-- Blogs feature: mini blog/CMS system (articles + static pages), categories,
-- comments with moderation, paywalled/pay-gated posts, subscriptions,
-- likes, per-post daily stats, and an admin moderation log.
--
-- Themes are NOT a new table — a blog theme is just a `store_items` row with
-- item_type = 'cosmetic' and cosmetic_type = 'blog_theme', purchased and
-- equipped through the existing /api/economy/cosmetics(+/equip) endpoints.
-- Revenue-share/earnings reuse the existing `creator_earnings` table with
-- source_type = 'blog_paywall'.

-- blogs — one blog per user
CREATE TABLE IF NOT EXISTS blogs (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    owner_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    slug text NOT NULL UNIQUE,
    title text NOT NULL,
    tagline text,
    description text,
    avatar_url text,
    cover_image_url text,
    theme_store_item_id uuid REFERENCES store_items(id) ON DELETE SET NULL,
    comments_enabled boolean DEFAULT true NOT NULL,
    comments_moderation_enabled boolean DEFAULT false NOT NULL,
    hide_author_info boolean DEFAULT false NOT NULL,
    show_subscriber_count boolean DEFAULT true NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    status_reason text,
    subscriber_count integer DEFAULT 0 NOT NULL,
    post_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT blogs_status_check CHECK (status = ANY (ARRAY['active'::text, 'paused'::text, 'suspended'::text, 'banned'::text, 'deactivated'::text]))
);

-- blog_categories
CREATE TABLE IF NOT EXISTS blog_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    blog_id uuid NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
    name text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_categories_blog_slug_idx UNIQUE (blog_id, slug)
);

-- blog_posts — articles (dated, listed reverse-chron) and pages (static, undated)
CREATE TABLE IF NOT EXISTS blog_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    blog_id uuid NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id uuid REFERENCES blog_categories(id) ON DELETE SET NULL,
    type text DEFAULT 'article' NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    excerpt text,
    body_markdown text NOT NULL,
    body_html text NOT NULL,
    featured_image_url text,
    status text DEFAULT 'draft' NOT NULL,
    is_paywalled boolean DEFAULT false NOT NULL,
    paywall_credits_cost integer DEFAULT 0 NOT NULL,
    word_count integer DEFAULT 0 NOT NULL,
    view_count integer DEFAULT 0 NOT NULL,
    like_count integer DEFAULT 0 NOT NULL,
    comment_count integer DEFAULT 0 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT blog_posts_type_check CHECK (type = ANY (ARRAY['article'::text, 'page'::text])),
    CONSTRAINT blog_posts_status_check CHECK (status = ANY (ARRAY['draft'::text, 'published'::text])),
    CONSTRAINT blog_posts_paywall_cost_check CHECK (paywall_credits_cost >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS blog_posts_blog_slug_live_idx ON blog_posts (blog_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS blog_posts_blog_status_published_idx ON blog_posts (blog_id, status, published_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS blog_posts_discovery_idx ON blog_posts (status, published_at DESC) WHERE deleted_at IS NULL AND type = 'article';
CREATE INDEX IF NOT EXISTS blog_posts_author_idx ON blog_posts (author_id);

-- blog_post_likes
CREATE TABLE IF NOT EXISTS blog_post_likes (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    post_id uuid NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_post_likes_post_user_idx UNIQUE (post_id, user_id)
);

-- blog_post_comments
CREATE TABLE IF NOT EXISTS blog_post_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    post_id uuid NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_comment_id uuid REFERENCES blog_post_comments(id) ON DELETE CASCADE,
    body text NOT NULL,
    status text DEFAULT 'visible' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT blog_post_comments_status_check CHECK (status = ANY (ARRAY['visible'::text, 'pending'::text, 'removed'::text]))
);

CREATE INDEX IF NOT EXISTS blog_post_comments_post_idx ON blog_post_comments (post_id, created_at DESC);

-- blog_subscriptions — visitors subscribing to a blog for new-post notifications
CREATE TABLE IF NOT EXISTS blog_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    blog_id uuid NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_subscriptions_blog_user_idx UNIQUE (blog_id, user_id)
);

CREATE INDEX IF NOT EXISTS blog_subscriptions_user_idx ON blog_subscriptions (user_id);

-- blog_post_unlocks — paywall unlock purchases (spend Credits to read the rest)
CREATE TABLE IF NOT EXISTS blog_post_unlocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    post_id uuid NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credits_spent integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blog_post_unlocks_post_user_idx UNIQUE (post_id, user_id)
);

-- blog_post_daily_stats — lightweight per-day rollup for creator/admin drill-down
CREATE TABLE IF NOT EXISTS blog_post_daily_stats (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    post_id uuid NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    date date NOT NULL,
    views integer DEFAULT 0 NOT NULL,
    likes integer DEFAULT 0 NOT NULL,
    comments integer DEFAULT 0 NOT NULL,
    unlock_count integer DEFAULT 0 NOT NULL,
    unlock_credits integer DEFAULT 0 NOT NULL,
    CONSTRAINT blog_post_daily_stats_post_date_idx UNIQUE (post_id, date)
);

CREATE INDEX IF NOT EXISTS blog_post_daily_stats_post_idx ON blog_post_daily_stats (post_id, date DESC);

-- blog_moderation_log — admin/moderator actions (ban/suspend/pause/delete/transfer/etc.)
CREATE TABLE IF NOT EXISTS blog_moderation_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    moderator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blog_id uuid REFERENCES blogs(id) ON DELETE CASCADE,
    post_id uuid REFERENCES blog_posts(id) ON DELETE CASCADE,
    target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    action text NOT NULL,
    reason text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS blog_moderation_log_blog_idx ON blog_moderation_log (blog_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- x_manifest defaults — admin-configurable Blogs settings (/admin/config)
-- ---------------------------------------------------------------------------
INSERT INTO x_manifest (key, value, description) VALUES
  ('feature_blogs', 'true', 'Master toggle for the Blogs feature'),
  ('blog_max_posts_free', '30', 'Max articles + pages (combined) for Free plan blogs'),
  ('blog_max_posts_plus', '100', 'Max articles + pages (combined) for Plus plan blogs'),
  ('blog_max_posts_pro', '200', 'Max articles + pages (combined) for Pro plan blogs'),
  ('blog_max_posts_max', '500', 'Max articles + pages (combined) for Max plan blogs'),
  ('blog_max_words_free', '1000', 'Max words per article for Free plan blogs'),
  ('blog_max_words_plus', '5000', 'Max words per article for Plus plan blogs'),
  ('blog_max_words_pro', '5000', 'Max words per article for Pro plan blogs'),
  ('blog_max_words_max', '5000', 'Max words per article for Max plan blogs'),
  ('blog_rev_share_pct_free', '40', 'Creator revenue share (%) for Free plan blog owners, after provider fees/VAT'),
  ('blog_rev_share_pct_plus', '50', 'Creator revenue share (%) for Plus plan blog owners, after provider fees/VAT'),
  ('blog_rev_share_pct_pro', '60', 'Creator revenue share (%) for Pro plan blog owners, after provider fees/VAT'),
  ('blog_rev_share_pct_max', '70', 'Creator revenue share (%) for Max plan blog owners, after provider fees/VAT'),
  ('blog_paystack_fee_pct', '3', 'Paystack payment processing fee (%) deducted before blog revenue share'),
  ('blog_google_play_fee_pct', '10', 'Google Play Billing fee (%) deducted before blog revenue share (IAP-funded unlocks)'),
  ('blog_vat_pct', '7.5', 'VAT (%) deducted before blog revenue share')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Store items — Blog themes (purchasable via the existing cosmetics store:
-- GET/POST /api/economy/cosmetics(+/equip), itemType='cosmetic', cosmeticType='blog_theme')
-- ---------------------------------------------------------------------------
INSERT INTO store_items (name, description, item_type, price_kobo, currency, coins_cost, stars_cost, coins_granted, stars_granted, cosmetic_type, bonus_label, is_featured, is_active, is_exclusive, sort_order, metadata) VALUES
  ('Editorial', 'A clean, magazine-style theme with a bold serif headline and generous whitespace.', 'cosmetic', 0, 'NGN', 500, NULL, NULL, NULL, 'blog_theme', NULL, true, true, false, 1, '{"themeKey":"editorial","accent":"#1f2937"}'),
  ('Noir', 'A moody dark theme with a high-contrast accent, built for long-form storytelling.', 'cosmetic', 0, 'NGN', 800, NULL, NULL, NULL, 'blog_theme', NULL, true, true, false, 2, '{"themeKey":"noir","accent":"#f59e0b"}'),
  ('Botanical', 'A warm, airy theme with soft greens and rounded cards — friendly for lifestyle blogs.', 'cosmetic', 0, 'NGN', 1200, NULL, NULL, NULL, 'blog_theme', NULL, false, true, false, 3, '{"themeKey":"botanical","accent":"#059669"}')
ON CONFLICT (name) DO NOTHING;
