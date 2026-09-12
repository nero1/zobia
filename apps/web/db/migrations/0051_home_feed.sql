-- ---------------------------------------------------------------------------
-- Home Dashboard feed infrastructure.
--
-- Adds:
--   - user_interests               — onboarding-selected + implicit-inferred
--                                     interest tags per user, weighted.
--   - content_engagement_signals   — lightweight implicit-interest event log,
--                                     periodically folded into user_interests
--                                     by the /api/cron/feed-refresh job, then
--                                     pruned (30-day TTL — see that job).
--   - zobian_of_month              — one row per calendar month: the
--                                     auto-computed (or admin-overridden)
--                                     "Zobian of the Month" pick.
--   - new_member_quest_dismissals  — durable server-side fallback for the
--                                     "don't remind again" New Member Quest
--                                     nudge. localStorage (scoped per-user-id)
--                                     is the fast path on the client; this
--                                     table only gets a write after 4 local
--                                     dismissals or an explicit "don't remind
--                                     again", so it stays low-traffic.
--   - notices                      — admin-manageable notices for the home
--                                     carousel. The carousel MERGES this table
--                                     with existing platform_events and
--                                     announcement_banners rows at query time
--                                     (see /api/notices) rather than requiring
--                                     admins to duplicate data already entered
--                                     elsewhere.
--
-- Also loosens the `ad_campaigns` CHECK constraints (migration 0006) so a
-- single "content boost" campaign shape can cover every boostable content
-- type on the platform, per the product decision that boosts are just a
-- sponsored-post ad objective under the existing Ads system — see
-- lib/ads/repo.ts createContentBoostCampaign().
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. user_interests
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_interests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    interest_tag text NOT NULL,
    source text NOT NULL,
    weight numeric(10,4) NOT NULL DEFAULT 1,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT user_interests_source_check CHECK (source = ANY (ARRAY['onboarding'::text, 'implicit'::text])),
    CONSTRAINT user_interests_user_tag_source_unique UNIQUE (user_id, interest_tag, source)
);

CREATE INDEX IF NOT EXISTS idx_user_interests_user ON user_interests (user_id);

-- ---------------------------------------------------------------------------
-- 2. content_engagement_signals — implicit interest tracking (write-heavy;
--    batch client-side, see the Home Dashboard UI work). Aggregated into
--    user_interests (source='implicit') by /api/cron/feed-refresh, which
--    also deletes rows older than 30 days — no separate archive table for
--    now (simple TTL cleanup is enough at this stage).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS content_engagement_signals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_type text NOT NULL,
    interest_tag text,
    event_type text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT content_engagement_signals_event_type_check
      CHECK (event_type = ANY (ARRAY['view'::text, 'like'::text, 'comment'::text, 'share'::text, 'open'::text]))
);

CREATE INDEX IF NOT EXISTS idx_content_engagement_signals_user_created
  ON content_engagement_signals (user_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. zobian_of_month
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS zobian_of_month (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    month date NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score numeric(18,4),
    is_admin_override boolean NOT NULL DEFAULT false,
    overridden_by uuid REFERENCES users(id) ON DELETE SET NULL,
    note text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT zobian_of_month_month_unique UNIQUE (month)
);

-- ---------------------------------------------------------------------------
-- 4. new_member_quest_dismissals
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS new_member_quest_dismissals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dismiss_count integer NOT NULL DEFAULT 0,
    last_dismissed_at timestamp with time zone,
    dont_remind_again boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT new_member_quest_dismissals_user_unique UNIQUE (user_id)
);

-- ---------------------------------------------------------------------------
-- 5. notices — admin-manageable Home carousel notices. Merged at query time
--    (see /api/notices) with active platform_events and announcement_banners
--    rows so admins are not asked to re-enter data that already exists.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    notice_type text NOT NULL DEFAULT 'custom',
    title text NOT NULL,
    body text,
    icon text,
    image_url text,
    cta_label text,
    cta_url text,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT notices_notice_type_check
      CHECK (notice_type = ANY (ARRAY['season'::text, 'event'::text, 'admin_news'::text, 'custom'::text]))
);

CREATE INDEX IF NOT EXISTS idx_notices_active_window ON notices (is_active, starts_at, ends_at);

-- ---------------------------------------------------------------------------
-- 6. Widen ad_campaigns.objective / boosted_content_type so any boostable
--    content type can be boosted through the existing ads pipeline (single
--    generic "boost_content" objective, discriminated by boosted_content_type).
--    'awareness'/'traffic'/'boost_post'/'boost_room' are kept for backward
--    compatibility with existing rows/queries.
-- ---------------------------------------------------------------------------

ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_objective_check;
ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_objective_check
  CHECK (objective = ANY (ARRAY[
    'awareness'::text, 'traffic'::text, 'boost_post'::text, 'boost_room'::text, 'boost_content'::text
  ]));

ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_boosted_content_type_check;
ALTER TABLE ad_campaigns ADD CONSTRAINT ad_campaigns_boosted_content_type_check
  CHECK (boosted_content_type IS NULL OR boosted_content_type = ANY (ARRAY[
    'moment'::text, 'tweet'::text, 'blog_post'::text, 'forum_thread'::text, 'forum_question'::text,
    'room'::text, 'wiki_page'::text, 'game'::text, 'classroom'::text, 'business_page_post'::text
  ]));

-- ---------------------------------------------------------------------------
-- 7. ad_placements — generic "content boost" placement used by
--    createContentBoostCampaign() (lib/ads/repo.ts) for boosting any content
--    type (moment/tweet/blog post/forum thread/room/wiki page/game/classroom/
--    business page post) inline in the Home Feed, rather than one placement
--    per content type.
-- ---------------------------------------------------------------------------

INSERT INTO ad_placements (key, label, size, description, base_cpm_credits, sort_order) VALUES
  ('content_boost', 'Content boost (native)', 'native', 'Generic sponsored-post placement for boosting any boostable content type inline in the Home Feed', 500, 15)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. x_manifest seed rows — admin-editable at /gate44/config ("Home Feed"
--    group). See lib/manifest/index.ts (interests / homeFeed blocks).
-- ---------------------------------------------------------------------------

INSERT INTO x_manifest (key, value, description) VALUES
  ('interests_onboarding_selection_enabled', 'true',
   'Show an interest-selection step during onboarding. When false, only implicit engagement-signal tracking is used for feed personalization.'),
  ('home_feed_cache_ttl_seconds', '900',
   'How long a Home Feed candidate pool (computed by /api/cron/feed-refresh) stays cached before the next cron run refreshes it. 15 minutes of staleness is acceptable.'),
  ('home_feed_page_size', '20',
   'Default number of items returned per Home Feed page.'),
  ('home_feed_zobian_of_month_auto_compute_enabled', 'true',
   'When true, /api/cron/feed-refresh auto-computes Zobian of the Month from monthly XP gain unless an admin has already set an override for the current month.')
ON CONFLICT (key) DO NOTHING;
