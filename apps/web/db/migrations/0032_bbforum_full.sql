-- 0032_bbforum_full.sql
--
-- Fleshes out the old-school BB-style forum stub (0016_bbforum.sql) into a
-- full-featured vBulletin/SMF-style board: rich content (plain text or
-- markdown), optional images, a quote system, reactions, edit/delete,
-- moderation-report linkage, and an OP-funded reply "pot"/treasury that
-- pays the first N qualifying repliers.

-- ---------------------------------------------------------------------------
-- Threads: content format, image, edit tracking, pot/treasury
-- ---------------------------------------------------------------------------

ALTER TABLE bb_threads
    ADD COLUMN IF NOT EXISTS content_format text NOT NULL DEFAULT 'plaintext',
    ADD COLUMN IF NOT EXISTS image_url text,
    ADD COLUMN IF NOT EXISTS edited_at timestamptz,
    ADD COLUMN IF NOT EXISTS pot_total_credits integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pot_per_claim_credits integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pot_max_claims integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pot_claims_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pot_refunded_at timestamptz;

ALTER TABLE bb_threads
    ADD CONSTRAINT bb_threads_content_format_check
        CHECK (content_format IN ('plaintext', 'markdown'));

-- ---------------------------------------------------------------------------
-- Posts: content format, image, quote reference, edit tracking, reactions
-- ---------------------------------------------------------------------------

ALTER TABLE bb_posts
    ADD COLUMN IF NOT EXISTS content_format text NOT NULL DEFAULT 'plaintext',
    ADD COLUMN IF NOT EXISTS image_url text,
    ADD COLUMN IF NOT EXISTS quoted_post_id uuid REFERENCES bb_posts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS edited_at timestamptz,
    ADD COLUMN IF NOT EXISTS reaction_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_op boolean NOT NULL DEFAULT false;

ALTER TABLE bb_posts
    ADD CONSTRAINT bb_posts_content_format_check
        CHECK (content_format IN ('plaintext', 'markdown'));

-- Mark existing first-posts-of-thread as OP for display purposes (best-effort
-- backfill; new rows are stamped explicitly by lib/bbforum/repo.ts).
UPDATE bb_posts p SET is_op = true
WHERE p.id = (
    SELECT p2.id FROM bb_posts p2 WHERE p2.thread_id = p.thread_id
    ORDER BY p2.created_at ASC LIMIT 1
);

-- ---------------------------------------------------------------------------
-- Reactions (one emoji reaction per user per post — toggled, not stacked)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bb_post_reactions (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    post_id uuid NOT NULL REFERENCES bb_posts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bb_post_reactions_post ON bb_post_reactions(post_id);

-- ---------------------------------------------------------------------------
-- Pot/treasury claims — idempotency + audit trail for who has been paid out
-- of a thread's OP-funded pot. One claim per user per thread.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bb_pot_claims (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    thread_id uuid NOT NULL REFERENCES bb_threads(id) ON DELETE CASCADE,
    post_id uuid NOT NULL REFERENCES bb_posts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_credits integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bb_pot_claims_thread ON bb_pot_claims(thread_id);

-- ---------------------------------------------------------------------------
-- Moderation report linkage — same moderation_reports table used everywhere
-- else, following the existing reported_forum_question_id/reported_forum_answer_id
-- convention for the Answers feature.
-- ---------------------------------------------------------------------------

ALTER TABLE moderation_reports
    ADD COLUMN IF NOT EXISTS reported_bb_thread_id uuid REFERENCES bb_threads(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reported_bb_post_id uuid REFERENCES bb_posts(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Board-level SEO: allow admin-managed boards beyond the seed set to get a
-- moderator level override is intentionally NOT added — the PRD calls for a
-- single site-wide minimum level for creating posts/replies, configured once
-- in x_manifest (bbforum_min_level_to_post, reused below for both actions).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Manifest defaults
-- ---------------------------------------------------------------------------

-- Reset the minimum level to the product default (Level 2) now that it also
-- gates replies, not just new threads. Safe to run more than once.
UPDATE x_manifest SET value = '2', updated_at = now()
WHERE key = 'bbforum_min_level_to_post' AND value = '1';

INSERT INTO x_manifest (key, value, description) VALUES
    ('bbforum_reward_xp_per_thread', '1', 'XP awarded for starting a new forum thread.'),
    ('bbforum_reward_credits_per_thread', '0', 'Credits awarded for starting a new forum thread.'),
    ('bbforum_reward_xp_per_reply', '1', 'XP awarded for replying to a forum thread.'),
    ('bbforum_reward_credits_per_reply', '0', 'Credits awarded for replying to a forum thread.'),
    ('bbforum_daily_reward_cap_credits', '50', 'Ceiling on total bbforum-sourced credit rewards a user can earn per rolling 24h.'),
    ('bbforum_auto_moderation_enabled', 'true', 'Run profanity/duplicate-post auto-moderation on new forum threads and posts.'),
    ('bbforum_image_cost_credits', '0', 'Credits charged to attach an image to a forum thread/post. 0 = free.'),
    ('bbforum_image_cost_stars', '0', 'Stars charged to attach an image to a forum thread/post. 0 = free.'),
    ('bbforum_pot_expiry_days', '14', 'Days of inactivity (no new pot claims) before an unclaimed thread pot balance is auto-refunded to its OP.')
ON CONFLICT (key) DO NOTHING;
