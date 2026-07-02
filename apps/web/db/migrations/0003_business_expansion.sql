-- 0003_business_expansion.sql
--
-- Business Accounts expansion (PRD §17):
--   - Business Pages: each business account can run 1+ pages (tier-gated
--     slot limit), post lightweight updates on them, and see stats whose
--     depth/breadth increases with tier — mirrors the Blogs stats-tier
--     convention (lib/blogs/limits.ts STATS_TIER) rather than inventing a
--     new one.
--   - Sponsored Quests gain a business-self-service path: a business page
--     can submit a Sponsored Quest for moderation (manual or AI, admin
--     toggle) instead of only admin being able to publish one.
--   - Self-service downgrade with a uniform 30-day grace period: extra
--     pages beyond the new tier's slot limit are deactivated and any
--     running sponsored quests are stopped once the grace period elapses.
--
-- Also fixes a pre-existing bug: app/api/admin/sponsored-quests/[questId]
-- reads/writes `sponsored_quests.deleted_at`, but that column was never
-- added to the schema (0001_consolidated_schema.sql) — the DELETE handler
-- would fail with "column deleted_at does not exist" today.

-- ---------------------------------------------------------------------------
-- business_accounts — self-service downgrade scheduling
-- ---------------------------------------------------------------------------
ALTER TABLE business_accounts
  ADD COLUMN IF NOT EXISTS downgrade_to_tier text,
  ADD COLUMN IF NOT EXISTS downgrade_effective_at timestamp with time zone;

-- ---------------------------------------------------------------------------
-- business_pages — one business account can own several pages (tier-gated
-- slot count). Adverts/sponsored quests are attributed to a page.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    business_account_id uuid NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    bio text,
    avatar_url text,
    cover_image_url text,
    status text DEFAULT 'active' NOT NULL,
    status_reason text,
    view_count integer DEFAULT 0 NOT NULL,
    post_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT business_pages_status_check CHECK (status = ANY (ARRAY['active'::text, 'deactivated'::text, 'suspended'::text, 'banned'::text]))
);

CREATE INDEX IF NOT EXISTS business_pages_account_idx ON business_pages (business_account_id, created_at ASC) WHERE deleted_at IS NULL;

-- business_page_posts — lightweight updates a business page can post
CREATE TABLE IF NOT EXISTS business_page_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    page_id uuid NOT NULL REFERENCES business_pages(id) ON DELETE CASCADE,
    title text NOT NULL,
    body text NOT NULL,
    image_url text,
    status text DEFAULT 'published' NOT NULL,
    view_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT business_page_posts_status_check CHECK (status = ANY (ARRAY['draft'::text, 'published'::text]))
);

CREATE INDEX IF NOT EXISTS business_page_posts_page_idx ON business_page_posts (page_id, created_at DESC) WHERE deleted_at IS NULL;

-- business_page_daily_stats — per-page/per-day rollup, same idiom as
-- blog_post_daily_stats (incremented alongside existing writes, no extra
-- Redis calls; powers the Growth/Enterprise drill-down + CSV export).
CREATE TABLE IF NOT EXISTS business_page_daily_stats (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    page_id uuid NOT NULL REFERENCES business_pages(id) ON DELETE CASCADE,
    date date NOT NULL,
    views integer DEFAULT 0 NOT NULL,
    post_views integer DEFAULT 0 NOT NULL,
    ad_impressions integer DEFAULT 0 NOT NULL,
    ad_clicks integer DEFAULT 0 NOT NULL,
    CONSTRAINT business_page_daily_stats_page_date_idx UNIQUE (page_id, date)
);

CREATE INDEX IF NOT EXISTS business_page_daily_stats_page_idx ON business_page_daily_stats (page_id, date DESC);

-- ---------------------------------------------------------------------------
-- sponsored_quests — business self-service submission + moderation, and the
-- missing deleted_at column (see header comment).
-- ---------------------------------------------------------------------------
ALTER TABLE sponsored_quests
  ADD COLUMN IF NOT EXISTS business_account_id uuid REFERENCES business_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS business_page_id uuid REFERENCES business_pages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Admin-published quests (business_account_id IS NULL) default to 'approved'
  -- so the existing admin-only flow is unaffected; business-submitted quests
  -- are inserted with 'pending' explicitly.
  ADD COLUMN IF NOT EXISTS moderation_status text DEFAULT 'approved' NOT NULL,
  ADD COLUMN IF NOT EXISTS moderation_reason text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

ALTER TABLE sponsored_quests
  DROP CONSTRAINT IF EXISTS sponsored_quests_moderation_status_check;
ALTER TABLE sponsored_quests
  ADD CONSTRAINT sponsored_quests_moderation_status_check CHECK (moderation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]));

CREATE INDEX IF NOT EXISTS sponsored_quests_business_idx ON sponsored_quests (business_account_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sponsored_quests_moderation_idx ON sponsored_quests (moderation_status) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- x_manifest defaults — admin-configurable Business Accounts settings
-- ---------------------------------------------------------------------------
INSERT INTO x_manifest (key, value, description) VALUES
  ('business_page_limit_starter', '2', 'Max Business Pages a Business Starter account may create'),
  ('business_page_limit_growth', '10', 'Max Business Pages a Business Growth account may create'),
  ('business_page_limit_enterprise', '50', 'Max Business Pages a Business Enterprise account may create'),
  ('sponsored_quest_moderation_mode', 'manual', 'How business-submitted Sponsored Quests are moderated: manual (admin queue) or ai (AI moderation with manual fallback)'),
  ('sponsored_quest_ai_auto_approve_threshold', '0.85', 'AI moderation confidence (0-1) at or above which a business-submitted Sponsored Quest is auto-approved when moderation mode is "ai"'),
  ('business_downgrade_grace_days', '30', 'Days after a business account tier downgrade before extra pages are deactivated and running sponsored quests are stopped')
ON CONFLICT (key) DO NOTHING;
