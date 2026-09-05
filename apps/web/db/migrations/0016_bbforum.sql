-- 0016_bbforum.sql
--
-- Old-school BB-style forum (boards → sub-boards → threads → posts), distinct
-- from the "Answers" Q&A feature (forum_questions/forum_answers). Home page
-- is /forum; individual threads get short, SEO-friendly canonical URLs at
-- /f/<slug> (see app/f/[slug]/page.tsx). This is an initial functional stub —
-- board/thread/post CRUD and navigation work, but moderation tooling,
-- reactions, and rich text are left for later iteration.

CREATE TABLE IF NOT EXISTS bb_boards (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    parent_id uuid REFERENCES bb_boards(id) ON DELETE CASCADE,
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    description text,
    icon_emoji text DEFAULT '💬',
    sort_order integer NOT NULL DEFAULT 0,
    thread_count integer NOT NULL DEFAULT 0,
    post_count integer NOT NULL DEFAULT 0,
    last_post_at timestamptz,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bb_boards_parent ON bb_boards(parent_id, sort_order);

CREATE TABLE IF NOT EXISTS bb_threads (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    board_id uuid NOT NULL REFERENCES bb_boards(id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES users(id),
    title text NOT NULL,
    slug text NOT NULL UNIQUE,
    is_locked boolean NOT NULL DEFAULT false,
    is_pinned boolean NOT NULL DEFAULT false,
    view_count integer NOT NULL DEFAULT 0,
    reply_count integer NOT NULL DEFAULT 0,
    last_reply_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'visible',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_bb_threads_board ON bb_threads(board_id, is_pinned DESC, last_reply_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bb_threads_slug ON bb_threads(slug) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS bb_posts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    thread_id uuid NOT NULL REFERENCES bb_threads(id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES users(id),
    body text NOT NULL,
    status text NOT NULL DEFAULT 'visible',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_bb_posts_thread ON bb_posts(thread_id, created_at ASC) WHERE deleted_at IS NULL;

INSERT INTO x_manifest (key, value, description) VALUES
    ('feature_bbforum', 'true', 'Enable the old-school BB-style forum at /forum.'),
    ('bbforum_min_level_to_post', '1', 'Minimum account level to start a thread or reply.')
ON CONFLICT (key) DO NOTHING;

-- Seed a handful of starter boards so /forum isn't empty on a fresh install.
INSERT INTO bb_boards (slug, name, description, icon_emoji, sort_order) VALUES
    ('general', 'General Discussion', 'Anything goes — introduce yourself, chat about the platform.', '💬', 1),
    ('help-support', 'Help & Support', 'Questions about using Zobia.', '🆘', 2),
    ('off-topic', 'Off-Topic', 'Everything else.', '🎲', 3)
ON CONFLICT (slug) DO NOTHING;
