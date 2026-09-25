-- Migration 0014: sitewide search — pg_trgm indexes + full-text ranking
--
-- Implements the two upgrades documented in docs/SEARCH.md's "Where this
-- approach starts to hurt" section:
--
-- 1. `ILIKE '%term%'` can't use a plain B-tree index (the leading `%` defeats
--    prefix matching), so at large table sizes each search branch degrades
--    to a sequential scan. Enabling pg_trgm and adding a GIN trigram index
--    per searched column turns `ILIKE '%term%'` into an index-accelerated
--    lookup with no application code changes required for that part alone.
--
-- 2. Results were ordered purely by recency — no relevance ranking, no
--    stemming, no term-frequency scoring. Each searched table gets a
--    generated, always-in-sync `search_vector` tsvector column (title/name
--    weighted 'A', secondary text 'B', long-form description 'C'), GIN
--    indexed, so app/api/search/route.ts can match with
--    `websearch_to_tsquery('english', q)` and order by `ts_rank(...)`.
--
-- The trigram indexes are kept (not dropped in favor of FTS-only) because
-- `websearch_to_tsquery` does whole-word/stemmed matching, not substring
-- matching — a query like "zob" won't match "zobia" via FTS the way it does
-- via `ILIKE '%zob%'`. The route now matches on EITHER condition (FTS OR
-- trigram-indexed ILIKE) so short/partial-word queries keep working exactly
-- as before, while full/stemmed-word queries additionally get relevance
-- ranking instead of pure recency ordering. Both index types are already
-- fast for their respective operator (`@@` and `ILIKE`), so combining them
-- does not reintroduce a sequential scan.
--
-- generatedcol `search_vector ... GENERATED ALWAYS AS (...) STORED` is
-- maintained by Postgres itself on every INSERT/UPDATE — no trigger, no
-- application code needed to keep it in sync. `to_tsvector(regconfig, text)`
-- with a literal config name is immutable (fixed dictionary/config, not
-- session-dependent), which is why this is allowed in a generated column
-- (see PostgreSQL docs §12.4.2, the canonical `to_tsvector('english', body)`
-- functional-index example).
--
-- No new tables here, so no Supabase Data-API GRANTs are needed (existing
-- grants on these tables already cover the new column/indexes).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- ---------------------------------------------------------------------
-- people (users: username, display_name, bio)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_username_trgm ON users USING gin (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_display_name_trgm ON users USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_bio_trgm ON users USING gin (bio gin_trgm_ops);

ALTER TABLE users ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(username, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(display_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(bio, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_users_search_vector ON users USING gin (search_vector);

-- ---------------------------------------------------------------------
-- blogs (blog_posts: title, excerpt)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_blog_posts_title_trgm ON blog_posts USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_blog_posts_excerpt_trgm ON blog_posts USING gin (excerpt gin_trgm_ops);

ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(excerpt, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_blog_posts_search_vector ON blog_posts USING gin (search_vector);

-- ---------------------------------------------------------------------
-- wikis (wiki_pages: title only — matches the existing search branch)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_wiki_pages_title_trgm ON wiki_pages USING gin (title gin_trgm_ops);

ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_wiki_pages_search_vector ON wiki_pages USING gin (search_vector);

-- ---------------------------------------------------------------------
-- answers (forum_questions: title, body)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_forum_questions_title_trgm ON forum_questions USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_forum_questions_body_trgm ON forum_questions USING gin (body gin_trgm_ops);

ALTER TABLE forum_questions ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_forum_questions_search_vector ON forum_questions USING gin (search_vector);

-- ---------------------------------------------------------------------
-- games (name, tagline, description)
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_games_name_trgm ON games USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_games_tagline_trgm ON games USING gin (tagline gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_games_description_trgm ON games USING gin (description gin_trgm_ops);

ALTER TABLE games ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(tagline, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_games_search_vector ON games USING gin (search_vector);

COMMIT;
