-- 0003_classroom_community.sql
--
-- ClassRooms become a Skool-style community + LMS, scoped per classroom
-- (rooms.type = 'classroom'). Everything below hangs off rooms.id — there is
-- still no separate "classroom" entity.
--
--   1. rooms gains classroom_settings (jsonb: slug-change policy, level names,
--      post categories, posting policy, moderator permissions) and
--      show_in_creator_listing (per-classroom toggle for the public
--      "Classrooms by @creator" listing page).
--   2. rooms.curriculum is normalised to the { "modules": [...] } object shape
--      the modules API has always read (POST /api/rooms used to store a bare
--      array, which made every later module add/edit fail), and every module
--      gets a stable string id so lesson completion can be tracked.
--   3. classroom_enrolments gains community-mute + last-activity columns.
--   4. classroom_moderators — creator-assigned moderators (wiki_collaborators
--      shape: user_id, role, is_moderator, moderator_granted_by/_at, status).
--   5. classroom_slug_history — the audit trail the slug-change transaction
--      writes (old/new slug, who, what it cost). 301s ride on the existing
--      slug_redirects table (entity_type 'room').
--   6. Community feed: classroom_posts, classroom_post_comments,
--      classroom_likes, classroom_reports.
--   7. classroom_lesson_completions — per-member lesson progress.
--   8. classroom_events — scheduled live sessions with an external meeting
--      URL (Zoom/Meet/…) and an optional recording link added afterwards.
--   9. Per-classroom gamification: classroom_points_ledger (idempotent,
--      mirrors xp_ledger's (user, source, reference_id) guard),
--      classroom_member_points (materialised totals + level, the read path for
--      the classroom leaderboard — same idea as game_best_scores) and
--      classroom_member_badges.
--  10. classroom_shares + classroom_daily_stats — share/page-view counters for
--      the creator panel's stats.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. rooms: classroom settings + creator-listing visibility
-- ---------------------------------------------------------------------------

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS classroom_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS show_in_creator_listing boolean DEFAULT true NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rooms_classroom_creator
  ON rooms (creator_id, created_at DESC)
  WHERE type = 'classroom' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Normalise rooms.curriculum to { modules: [...] } with stable module ids
-- ---------------------------------------------------------------------------

UPDATE rooms
   SET curriculum = jsonb_build_object('modules', curriculum)
 WHERE type = 'classroom'
   AND curriculum IS NOT NULL
   AND jsonb_typeof(curriculum) = 'array';

UPDATE rooms r
   SET curriculum = jsonb_set(
         r.curriculum,
         '{modules}',
         (
           SELECT COALESCE(
                    jsonb_agg(
                      CASE
                        WHEN jsonb_typeof(e.m) = 'object' AND e.m ? 'id' THEN e.m
                        WHEN jsonb_typeof(e.m) = 'object' THEN e.m || jsonb_build_object('id', gen_random_uuid()::text)
                        ELSE jsonb_build_object('id', gen_random_uuid()::text, 'title', e.m #>> '{}')
                      END
                      ORDER BY e.ord
                    ),
                    '[]'::jsonb
                  )
             FROM jsonb_array_elements(r.curriculum->'modules') WITH ORDINALITY AS e(m, ord)
         )
       )
 WHERE r.type = 'classroom'
   AND r.curriculum IS NOT NULL
   AND jsonb_typeof(r.curriculum->'modules') = 'array';

-- ---------------------------------------------------------------------------
-- 3. classroom_enrolments: community mute + activity tracking
-- ---------------------------------------------------------------------------

ALTER TABLE classroom_enrolments
  ADD COLUMN IF NOT EXISTS muted_until timestamp with time zone,
  ADD COLUMN IF NOT EXISTS muted_by uuid,
  ADD COLUMN IF NOT EXISTS last_active_at timestamp with time zone;

ALTER TABLE classroom_enrolments DROP CONSTRAINT IF EXISTS classroom_enrolments_muted_by_fkey;
ALTER TABLE classroom_enrolments ADD CONSTRAINT classroom_enrolments_muted_by_fkey
  FOREIGN KEY (muted_by) REFERENCES users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 4. classroom_moderators (wiki_collaborators shape)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS classroom_moderators (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'moderator'::text NOT NULL,
    is_moderator boolean DEFAULT true NOT NULL,
    moderator_granted_by uuid,
    moderator_granted_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_moderators_pkey PRIMARY KEY (id),
    CONSTRAINT classroom_moderators_room_user_key UNIQUE (room_id, user_id),
    CONSTRAINT classroom_moderators_role_check CHECK ((role = ANY (ARRAY['moderator'::text]))),
    CONSTRAINT classroom_moderators_status_check CHECK ((status = ANY (ARRAY['active'::text, 'removed'::text]))),
    CONSTRAINT classroom_moderators_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT classroom_moderators_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT classroom_moderators_granted_by_fkey FOREIGN KEY (moderator_granted_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_classroom_moderators_user ON classroom_moderators (user_id) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- 5. classroom_slug_history
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS classroom_slug_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    old_slug text,
    new_slug text NOT NULL,
    changed_by uuid,
    cost_credits integer DEFAULT 0 NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_slug_history_pkey PRIMARY KEY (id),
    CONSTRAINT classroom_slug_history_cost_check CHECK ((cost_credits >= 0)),
    CONSTRAINT classroom_slug_history_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT classroom_slug_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_classroom_slug_history_room ON classroom_slug_history (room_id, changed_at DESC);

-- ---------------------------------------------------------------------------
-- 6. Community feed
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS classroom_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    author_id uuid NOT NULL,
    category text DEFAULT 'General'::text NOT NULL,
    title text,
    body text NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    is_locked boolean DEFAULT false NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    hidden_by uuid,
    hidden_at timestamp with time zone,
    like_count integer DEFAULT 0 NOT NULL,
    comment_count integer DEFAULT 0 NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT classroom_posts_pkey PRIMARY KEY (id),
    CONSTRAINT classroom_posts_body_len CHECK ((char_length(body) BETWEEN 1 AND 10000)),
    CONSTRAINT classroom_posts_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT classroom_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT classroom_posts_hidden_by_fkey FOREIGN KEY (hidden_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_classroom_posts_feed
  ON classroom_posts (room_id, is_pinned DESC, last_activity_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_classroom_posts_author ON classroom_posts (author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS classroom_post_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    room_id uuid NOT NULL,
    author_id uuid NOT NULL,
    parent_id uuid,
    body text NOT NULL,
    like_count integer DEFAULT 0 NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    hidden_by uuid,
    hidden_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT classroom_post_comments_pkey PRIMARY KEY (id),
    CONSTRAINT classroom_post_comments_body_len CHECK ((char_length(body) BETWEEN 1 AND 4000)),
    CONSTRAINT classroom_post_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES classroom_posts(id) ON DELETE CASCADE,
    CONSTRAINT classroom_post_comments_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT classroom_post_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT classroom_post_comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES classroom_post_comments(id) ON DELETE CASCADE,
    CONSTRAINT classroom_post_comments_hidden_by_fkey FOREIGN KEY (hidden_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_classroom_post_comments_post ON classroom_post_comments (post_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_classroom_post_comments_room ON classroom_post_comments (room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS classroom_likes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    post_id uuid,
    comment_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_likes_pkey PRIMARY KEY (id),
    CONSTRAINT classroom_likes_one_target CHECK ((((post_id IS NOT NULL))::integer + ((comment_id IS NOT NULL))::integer) = 1),
    CONSTRAINT classroom_likes_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT classroom_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT classroom_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES classroom_posts(id) ON DELETE CASCADE,
    CONSTRAINT classroom_likes_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES classroom_post_comments(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_classroom_likes_post ON classroom_likes (user_id, post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_classroom_likes_comment ON classroom_likes (user_id, comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_classroom_likes_room ON classroom_likes (room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS classroom_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    reporter_id uuid NOT NULL,
    post_id uuid,
    comment_id uuid,
    reason text NOT NULL,
    details text,
    status text DEFAULT 'pending'::text NOT NULL,
    escalated boolean DEFAULT false NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_reports_pkey PRIMARY KEY (id),
    CONSTRAINT classroom_reports_one_target CHECK ((((post_id IS NOT NULL))::integer + ((comment_id IS NOT NULL))::integer) = 1),
    CONSTRAINT classroom_reports_reason_check CHECK ((reason = ANY (ARRAY['spam'::text, 'harassment'::text, 'hate_speech'::text, 'sexual_content'::text, 'misinformation'::text, 'scam'::text, 'off_topic'::text, 'other'::text]))),
    CONSTRAINT classroom_reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'resolved_removed'::text, 'resolved_dismissed'::text]))),
    CONSTRAINT classroom_reports_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT classroom_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT classroom_reports_post_id_fkey FOREIGN KEY (post_id) REFERENCES classroom_posts(id) ON DELETE CASCADE,
    CONSTRAINT classroom_reports_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES classroom_post_comments(id) ON DELETE CASCADE,
    CONSTRAINT classroom_reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- One open report per reporter per target (flood control).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_classroom_reports_open_post
  ON classroom_reports (reporter_id, post_id) WHERE post_id IS NOT NULL AND status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uidx_classroom_reports_open_comment
  ON classroom_reports (reporter_id, comment_id) WHERE comment_id IS NOT NULL AND status = 'pending';
CREATE INDEX IF NOT EXISTS idx_classroom_reports_room_status ON classroom_reports (room_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_classroom_reports_escalated ON classroom_reports (created_at DESC) WHERE status = 'pending' AND escalated = true;

-- ---------------------------------------------------------------------------
-- 7. Lesson progress
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS classroom_lesson_completions (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    module_id text NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_lesson_completions_pkey PRIMARY KEY (room_id, user_id, module_id),
    CONSTRAINT classroom_lesson_completions_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT classroom_lesson_completions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_classroom_lesson_completions_room ON classroom_lesson_completions (room_id, completed_at DESC);

-- ---------------------------------------------------------------------------
-- 8. Scheduled live sessions (external meeting URL + recording link)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS classroom_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone,
    meeting_url text,
    recording_url text,
    recording_added_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT classroom_events_pkey PRIMARY KEY (id),
    CONSTRAINT classroom_events_title_len CHECK ((char_length(title) BETWEEN 1 AND 200)),
    CONSTRAINT classroom_events_time_order CHECK (((ends_at IS NULL) OR (ends_at > starts_at))),
    CONSTRAINT classroom_events_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT classroom_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_classroom_events_room ON classroom_events (room_id, starts_at) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 9. Per-classroom gamification
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS classroom_points_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount integer NOT NULL,
    source text NOT NULL,
    reference_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_points_ledger_pkey PRIMARY KEY (id),
    CONSTRAINT classroom_points_ledger_amount_nonzero CHECK ((amount <> 0)),
    CONSTRAINT classroom_points_ledger_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT classroom_points_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_classroom_points_ledger_ref
  ON classroom_points_ledger (room_id, user_id, source, reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_classroom_points_ledger_room_time ON classroom_points_ledger (room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS classroom_member_points (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    points bigint DEFAULT 0 NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_member_points_pkey PRIMARY KEY (room_id, user_id),
    CONSTRAINT classroom_member_points_points_nonneg CHECK ((points >= 0)),
    CONSTRAINT classroom_member_points_level_range CHECK ((level BETWEEN 1 AND 9)),
    CONSTRAINT classroom_member_points_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT classroom_member_points_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_classroom_member_points_board ON classroom_member_points (room_id, points DESC, user_id);

CREATE TABLE IF NOT EXISTS classroom_member_badges (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    badge_key text NOT NULL,
    awarded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_member_badges_pkey PRIMARY KEY (room_id, user_id, badge_key),
    CONSTRAINT classroom_member_badges_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT classroom_member_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- 10. Share + page-view counters (creator panel stats)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS classroom_shares (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    share_count integer DEFAULT 1 NOT NULL,
    first_shared_at timestamp with time zone DEFAULT now() NOT NULL,
    last_shared_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT classroom_shares_pkey PRIMARY KEY (room_id, user_id),
    CONSTRAINT classroom_shares_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    CONSTRAINT classroom_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS classroom_daily_stats (
    room_id uuid NOT NULL,
    day date NOT NULL,
    page_views integer DEFAULT 0 NOT NULL,
    shares integer DEFAULT 0 NOT NULL,
    CONSTRAINT classroom_daily_stats_pkey PRIMARY KEY (room_id, day),
    CONSTRAINT classroom_daily_stats_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

COMMIT;
