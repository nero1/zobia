BEGIN;
CREATE TABLE IF NOT EXISTS tales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 slug text NOT NULL UNIQUE, title text NOT NULL, synopsis text NOT NULL DEFAULT '', cover_url text,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','removed')),
 moderation text NOT NULL DEFAULT 'pending' CHECK(moderation IN ('pending','approved','rejected')),
 moderation_reason text, version integer NOT NULL DEFAULT 1, comments_enabled boolean NOT NULL DEFAULT true,
 default_price integer NOT NULL DEFAULT 0 CHECK(default_price BETWEEN 0 AND 1000000),
 notify_subscribers boolean NOT NULL DEFAULT false, votes integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX IF NOT EXISTS tales_discovery_idx ON tales(status,moderation,published_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS tale_chapters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tale_id uuid NOT NULL REFERENCES tales(id) ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK(ordinal>0), title text NOT NULL, body text NOT NULL,
 price integer CHECK(price BETWEEN 0 AND 1000000),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','scheduled')),
 publish_at timestamptz, moderation text NOT NULL DEFAULT 'pending' CHECK(moderation IN ('pending','approved','rejected')),
 moderation_reason text, version integer NOT NULL DEFAULT 1, notified boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tale_id,ordinal), CHECK(ordinal<>1 OR price IS NULL OR price=0)
);
CREATE TABLE IF NOT EXISTS tale_unlocks (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, chapter_id uuid NOT NULL REFERENCES tale_chapters(id) ON DELETE CASCADE,
 cost integer NOT NULL CHECK(cost>=0), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,chapter_id)
);
CREATE TABLE IF NOT EXISTS tale_author_subscriptions (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,author_id), CHECK(user_id<>author_id)
);
CREATE TABLE IF NOT EXISTS tale_votes (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, tale_id uuid NOT NULL REFERENCES tales(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,tale_id)
);
CREATE TABLE IF NOT EXISTS tale_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 tale_id uuid NOT NULL REFERENCES tales(id) ON DELETE CASCADE, chapter_id uuid REFERENCES tale_chapters(id) ON DELETE CASCADE,
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000), hidden boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tale_comments_page_idx ON tale_comments(tale_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS tale_account_restrictions (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 state text NOT NULL CHECK(state IN ('active','suspended','banned','demonetized')), reason text NOT NULL,
 expires_at timestamptz, version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tale_appeals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 target_type text NOT NULL CHECK(target_type IN ('story','chapter','account')), target_id uuid NOT NULL, target_version integer NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 4000), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
 decision_reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tale_appeal_pending_idx ON tale_appeals(user_id,target_type,target_id) WHERE status='pending';
-- Access is through authenticated server APIs; first-chapter public access is explicitly filtered there.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['tales','tale_chapters','tale_unlocks','tale_author_subscriptions','tale_votes','tale_comments','tale_account_restrictions','tale_appeals'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON %I FROM anon,authenticated',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO service_role',t);
 END LOOP;
END $$;
INSERT INTO x_manifest(key,value,description) VALUES
 ('tales_free_published_limit','10','Maximum published stories for Free writers.'),
 ('tales_free_draft_limit','20','Maximum draft stories for Free writers.'),
 ('tales_min_level','2','Minimum main rank to write Tales.'),
 ('tales_appeal_limit','3','Maximum appeals per story, chapter, or Tales account.')
ON CONFLICT(key) DO NOTHING;
ALTER TABLE content_treasuries DROP CONSTRAINT IF EXISTS content_treasuries_type_check;
ALTER TABLE content_treasuries ADD CONSTRAINT content_treasuries_type_check CHECK(content_type IN ('poll','quiz','wiki','room','tale','tale_chapter'));
ALTER TABLE content_shares DROP CONSTRAINT IF EXISTS content_shares_type_check;
ALTER TABLE content_shares ADD CONSTRAINT content_shares_type_check CHECK(content_type IN ('poll','quiz','wiki','room','tale','tale_chapter'));
COMMIT;
