-- 0034_help_center.sql
--
-- Help Center: database-backed categories + docs replacing/augmenting the
-- static /help FAQ page, with per-doc difficulty tiers, SEO metadata, and
-- Postgres full-text search (no new search infra).

CREATE TABLE IF NOT EXISTS help_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    published boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS help_docs (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    category_id uuid NOT NULL REFERENCES help_categories(id) ON DELETE CASCADE,
    slug text NOT NULL,
    title text NOT NULL,
    -- Reuses the same markdown-authored / rendered-HTML pair convention as
    -- blog_posts.body_markdown / body_html (see 0002_blogs.sql).
    body_markdown text NOT NULL,
    body_html text NOT NULL,
    difficulty text DEFAULT 'first_time' NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    seo_title text,
    seo_description text,
    published boolean DEFAULT false NOT NULL,
    view_count integer DEFAULT 0 NOT NULL,
    author_id uuid REFERENCES users(id) ON DELETE SET NULL,
    -- Populated/refreshed by a trigger below for full-text search.
    search_vector tsvector,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT help_docs_category_slug_idx UNIQUE (category_id, slug),
    CONSTRAINT help_docs_difficulty_check CHECK (difficulty = ANY (ARRAY['first_time'::text, 'beginner'::text, 'intermediate'::text, 'advanced'::text]))
);

-- Widen slug_redirects to cover help center entities, so a doc/category
-- rename (which changes its slug) can 301 old links instead of 404ing —
-- mirrors lib/slug.ts's recordSlugRedirect/lookupSlugRedirect used by
-- rooms/games/forum_questions.
ALTER TABLE slug_redirects DROP CONSTRAINT IF EXISTS slug_redirects_entity_type_check;
ALTER TABLE slug_redirects ADD CONSTRAINT slug_redirects_entity_type_check
    CHECK (entity_type = ANY (ARRAY['room'::text, 'game'::text, 'forum_question'::text, 'help_doc'::text, 'help_category'::text]));

CREATE INDEX IF NOT EXISTS idx_help_docs_category ON help_docs USING btree (category_id, sort_order) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_help_docs_published ON help_docs USING btree (published, updated_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_help_docs_search ON help_docs USING gin (search_vector);

-- Keep search_vector in sync on write (title weighted higher than body).
CREATE OR REPLACE FUNCTION help_docs_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.body_markdown, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_help_docs_search_vector ON help_docs;
CREATE TRIGGER trg_help_docs_search_vector
  BEFORE INSERT OR UPDATE OF title, body_markdown ON help_docs
  FOR EACH ROW EXECUTE FUNCTION help_docs_search_vector_update();

-- x_manifest seed defaults for the Help Center.
INSERT INTO x_manifest (key, value, description) VALUES
    ('feature_help_center', 'true', 'Master on/off switch for the database-backed Help Center (/help). When false, the static FAQ fallback is shown.'),
    ('help_center_ai_free_for_all', 'false', 'When true, "Contact a real person" from a Help Center AI answer is always free regardless of support_ticket_cost_credits/stars, and the cost messaging is hidden entirely.')
ON CONFLICT (key) DO NOTHING;
