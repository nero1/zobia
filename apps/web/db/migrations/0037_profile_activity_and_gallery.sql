-- 0037_profile_activity_and_gallery.sql
--
-- Profile page additions:
--   1. "Activities" tab — a read-only feed of a user's public activity
--      (rank-ups, badges/achievements, guild joins), built from tables that
--      already exist (rank_up_events, user_badges, guild_members). No new
--      logging pipeline, no new Redis usage — see
--      app/api/users/[userId]/activity/route.ts.
--   2. Its visibility is controlled by the SAME generic mechanism already
--      used to hide other profile sections (x_manifest 'privacy_hideable_sections'
--      + users.profile_hidden_sections, see app/api/users/me/privacy/route.ts) —
--      "activities" is simply added to the admin-controlled hideable list here,
--      rather than inventing a bespoke new column/flag.
--   3. Indexes to keep the new activity-feed and profile-gallery (Moments)
--      queries cheap on a free-tier Postgres instance — plain SQL with LIMIT,
--      no caching layer.

-- Add "activities" to the admin-configurable list of profile sections a
-- user may hide (see privacy_hideable_sections). Idempotent: only appends
-- when not already present, so re-running this migration or an admin who
-- already edited the list via /gate44/settings/privacy is a no-op either way.
UPDATE x_manifest
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT elem))::text
  FROM jsonb_array_elements_text(value::jsonb || '["activities"]'::jsonb) AS elem
)
WHERE key = 'privacy_hideable_sections'
  AND NOT (value::jsonb @> '["activities"]'::jsonb);

-- In case the seed row itself is somehow missing (fresh DB that skipped the
-- consolidated schema's seed insert), make sure it exists with "activities"
-- included.
INSERT INTO x_manifest (key, value, description) VALUES
  ('privacy_hideable_sections', '["avatar", "bio", "rank", "xp", "guild", "seasons", "badges", "activities"]', 'Profile sections that users can hide (admin-controlled list). JSON array.')
ON CONFLICT (key) DO NOTHING;

-- Activity feed source tables already exist; index them for the profile
-- Activities tab's per-user, recency-ordered LIMIT query.
CREATE INDEX IF NOT EXISTS idx_rank_up_events_user_created ON rank_up_events USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_badges_user_awarded ON user_badges USING btree (user_id, awarded_at DESC);
CREATE INDEX IF NOT EXISTS idx_guild_members_user_joined ON guild_members USING btree (user_id, joined_at DESC);

-- Profile photo gallery reuses Moments (the only existing public per-user
-- image source) filtered by user_id + media presence; idx_moments_user
-- already exists (0001) but lacks created_at ordering for that filter.
CREATE INDEX IF NOT EXISTS idx_moments_user_created ON moments USING btree (user_id, created_at DESC);
