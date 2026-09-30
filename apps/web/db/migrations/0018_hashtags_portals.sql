-- Migration 0018: hashtags + Portals
--
-- Adds hashtag storage and "Portals" (/h/<slug>): hashtag-driven mini-portals
-- that gather content from every primitive (moments, tweets, blogs, forum,
-- BB forum, rooms, guilds, wiki, polls, quizzes) into one discovery page.
--
--   hashtags          normalised tag vocabulary (+ alias/merge + blocklist)
--   content_hashtags  (content_type, content_id) -> hashtag link rows,
--                     written by lib/hashtags/service.ts on every content write
--   portals           one row per portal: admin-curated ("official") or
--                     promoted from trending tags ("auto"); carries the admin
--                     boost dial that drives feed prominence
--   portal_follows    a user following a portal
--   portal_stats_daily per-portal daily views / impressions / clicks / follows
--                     (admin analytics; one upsert per event, no Redis)
--
-- All five are brand-new tables, so per the project's Supabase Data-API rule
-- each gets explicit GRANTs below. RLS is enabled on all of them; only the
-- genuinely public read surfaces (hashtags, content_hashtags, non-suppressed
-- portals) get an anon/authenticated SELECT policy. All writes go through the
-- server (service_role bypasses RLS).
--
-- Also seeds the x_manifest settings (/gate44/config "Portals" group) and the
-- portal page ad placements (<AdSlot placement="portal_*"/>).

BEGIN;

-- ---------------------------------------------------------------------------
-- hashtags
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hashtags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL,
  display       text NOT NULL,
  -- When set, this tag was merged into another; reads follow the alias.
  alias_of      uuid REFERENCES hashtags(id) ON DELETE SET NULL,
  -- Admin blocklist: blocked tags are never linked, never become portals.
  is_blocked    boolean NOT NULL DEFAULT false,
  use_count     integer NOT NULL DEFAULT 0,
  last_used_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hashtags_slug_format CHECK (slug = lower(slug) AND char_length(slug) BETWEEN 2 AND 50),
  CONSTRAINT hashtags_not_self_alias CHECK (alias_of IS NULL OR alias_of <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hashtags_slug ON hashtags (slug);
CREATE INDEX IF NOT EXISTS idx_hashtags_alias_of ON hashtags (alias_of) WHERE alias_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hashtags_last_used ON hashtags (last_used_at DESC) WHERE is_blocked = false;
-- Prefix/typo-tolerant tag search (pg_trgm is already installed, see 0014).
CREATE INDEX IF NOT EXISTS idx_hashtags_slug_trgm ON hashtags USING gin (slug gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- content_hashtags
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_hashtags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hashtag_id    uuid NOT NULL REFERENCES hashtags(id) ON DELETE CASCADE,
  -- Mirrors lib/feed/types.ts FeedContentType (+ guild, which the feed lacks).
  content_type  text NOT NULL,
  content_id    uuid NOT NULL,
  -- Denormalised author so distinct-author counts (auto-portal anti-spam)
  -- need no joins into ten different content tables.
  author_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_hashtags_type_check CHECK (content_type IN (
    'moment','tweet','blog_post','forum_thread','forum_question','room',
    'classroom','wiki_page','game','poll','quiz','guild','business_page_post'
  ))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_hashtags_unique ON content_hashtags (content_type, content_id, hashtag_id);
-- Portal page / tag page reads: newest content for one tag.
CREATE INDEX IF NOT EXISTS idx_content_hashtags_tag_created ON content_hashtags (hashtag_id, created_at DESC);
-- Per-type section reads on a portal page.
CREATE INDEX IF NOT EXISTS idx_content_hashtags_tag_type ON content_hashtags (hashtag_id, content_type, created_at DESC);
-- Trending velocity scan (cron) over the recent window.
CREATE INDEX IF NOT EXISTS idx_content_hashtags_created ON content_hashtags (created_at DESC);

-- ---------------------------------------------------------------------------
-- portals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL,
  hashtag_id       uuid NOT NULL REFERENCES hashtags(id) ON DELETE CASCADE,
  title            text NOT NULL,
  tagline          text,
  description      text,
  cover_image_url  text,
  accent_color     text,
  -- official   = admin-curated, never auto-archived, verified badge
  -- auto       = promoted from a trending tag by /api/cron/feed-refresh
  -- archived   = was auto, went quiet; page still resolves, hidden from discovery
  -- suppressed = admin hid it entirely (404s publicly)
  status           text NOT NULL DEFAULT 'auto',
  -- Ordered section config: [{ "key": "feed", "enabled": true }, ...]
  sections         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Optional official forum board this portal fronts (/forum, /f/<slug>).
  bb_board_id      uuid REFERENCES bb_boards(id) ON DELETE SET NULL,
  -- Optional place/school keyword matched against guild city + profile city.
  city             text,
  is_pinned        boolean NOT NULL DEFAULT false,
  -- Admin boost dial (0-100): how often this portal is suggested in feeds.
  boost_weight     smallint NOT NULL DEFAULT 0,
  boost_starts_at  timestamptz,
  boost_ends_at    timestamptz,
  sponsored_until  timestamptz,
  sponsor_name     text,
  follower_count   integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portals_status_check CHECK (status IN ('official','auto','archived','suppressed')),
  CONSTRAINT portals_boost_weight_check CHECK (boost_weight BETWEEN 0 AND 100),
  CONSTRAINT portals_slug_format CHECK (slug = lower(slug) AND char_length(slug) BETWEEN 2 AND 50),
  CONSTRAINT portals_accent_color_check CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_portals_slug ON portals (slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_portals_hashtag ON portals (hashtag_id);
CREATE INDEX IF NOT EXISTS idx_portals_status_activity ON portals (status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_portals_boost ON portals (boost_weight DESC) WHERE boost_weight > 0;
CREATE INDEX IF NOT EXISTS idx_portals_title_trgm ON portals USING gin (title gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- portal_follows
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_follows (
  portal_id   uuid NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (portal_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_portal_follows_user ON portal_follows (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- portal_stats_daily
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_stats_daily (
  portal_id    uuid NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
  day          date NOT NULL DEFAULT CURRENT_DATE,
  views        integer NOT NULL DEFAULT 0,
  impressions  integer NOT NULL DEFAULT 0,
  clicks       integer NOT NULL DEFAULT 0,
  follows      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (portal_id, day)
);

-- ---------------------------------------------------------------------------
-- Grants (Supabase Data-API rule: new public tables need explicit GRANTs)
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.hashtags TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hashtags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hashtags TO service_role;

GRANT SELECT ON public.content_hashtags TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_hashtags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_hashtags TO service_role;

GRANT SELECT ON public.portals TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portals TO service_role;

GRANT SELECT ON public.portal_follows TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_follows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_follows TO service_role;

GRANT SELECT ON public.portal_stats_daily TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_stats_daily TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_stats_daily TO service_role;

-- ---------------------------------------------------------------------------
-- Row level security: default-deny, with public read only where the data is
-- already public. portal_follows / portal_stats_daily have no policies, so the
-- Data API returns nothing for anon/authenticated even though they hold the
-- table-level grant; the server (service_role) bypasses RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE hashtags ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_hashtags ENABLE ROW LEVEL SECURITY;
ALTER TABLE portals ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_stats_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hashtags_public_read ON hashtags;
CREATE POLICY hashtags_public_read ON hashtags FOR SELECT TO anon, authenticated USING (is_blocked = false);

DROP POLICY IF EXISTS content_hashtags_public_read ON content_hashtags;
CREATE POLICY content_hashtags_public_read ON content_hashtags FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS portals_public_read ON portals;
CREATE POLICY portals_public_read ON portals FOR SELECT TO anon, authenticated USING (status <> 'suppressed');

-- ---------------------------------------------------------------------------
-- Ad placements for portal pages (plugs into the existing <AdSlot/> system)
-- ---------------------------------------------------------------------------
INSERT INTO ad_placements (key, label, size, description, is_active, sort_order) VALUES
  ('portal_top', 'Portal — top banner', '320x50', 'Shown under the header of a /h/<slug> portal page.', true, 110),
  ('portal_after_3', 'Portal — after 3rd feed item', 'native', 'Shown after the 3rd item of a portal''s mini discovery feed.', true, 111),
  ('portal_bottom', 'Portal — bottom banner', '320x50', 'Shown at the bottom of a portal page.', true, 112)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Admin settings (/gate44/config, "Portals" group)
-- ---------------------------------------------------------------------------
INSERT INTO x_manifest (key, value, description) VALUES
  ('feature_portals', 'true', 'Master toggle for Hashtags and Portals (/h/<slug>). When off, hashtag pages and feed portal suggestions are hidden and portal APIs return 503.'),
  ('portals_auto_create_enabled', 'true', 'When true, /api/cron/feed-refresh promotes trending hashtags to auto portals once they pass the thresholds.'),
  ('portals_auto_min_posts', '20', 'Tagged posts required inside the trending window before a hashtag becomes an auto portal.'),
  ('portals_auto_min_distinct_users', '8', 'Distinct authors required inside the trending window before a hashtag becomes an auto portal (anti-spam).'),
  ('portals_trending_window_hours', '48', 'Window in hours used for tag velocity and the auto-portal thresholds.'),
  ('portals_archive_after_days', '30', 'Auto portals with no tagged activity for this many days are archived. Official portals are never auto-archived.'),
  ('portals_feed_suggestion_every', '8', 'Insert one "Portals for you" card after this many Home Feed items. 0 turns suggestions off.'),
  ('portals_feed_suggestion_max_portals', '6', 'Maximum portals shown in a single feed suggestion card.'),
  ('portals_cache_ttl_seconds', '600', 'How long a portal page payload stays cached (memory + Redis), in seconds.')
ON CONFLICT (key) DO NOTHING;

COMMIT;
