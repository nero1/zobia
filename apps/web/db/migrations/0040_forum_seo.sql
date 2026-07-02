-- =====================================================================
-- 0040_forum_seo.sql
--
-- SEO for Zobia Answers (mini forum / Q&A, added in 0039):
--   - forum_questions get a slug column (SEO-friendly public URL), following
--     the exact same convention as rooms/games (0012_slugs_and_referrals.sql):
--     base slug = lowercased title with non-alphanumerics collapsed to '-',
--     duplicates get a numeric suffix with no separator ("my-question",
--     "my-question2", ...). The UUID primary key remains the immutable
--     internal reference. `slug_redirects` gains 'forum_question' as a valid
--     entity_type so renamed/retired slugs 301 instead of 404ing.
--   - forum_categories: a lightweight taxonomy (not in the original PRD §31
--     spec) so questions can be organised/browsed by topic and so the seed
--     data below has somewhere to live. Purely additive — category_id is
--     nullable, existing questions/flows are unaffected if left uncategorised.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Categories
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS forum_categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  icon_emoji   TEXT NOT NULL DEFAULT '💬',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS forum_categories_slug_unique_idx ON forum_categories (slug);

ALTER TABLE forum_questions ADD COLUMN IF NOT EXISTS category_id UUID
  REFERENCES forum_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_forum_questions_category ON forum_questions (category_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 2. Slugs for forum_questions
-- ---------------------------------------------------------------------

ALTER TABLE forum_questions ADD COLUMN IF NOT EXISTS slug TEXT;

WITH raw AS (
  SELECT
    id,
    created_at,
    left(
      trim(BOTH '-' FROM regexp_replace(lower(coalesce(title, '')), '[^a-z0-9]+', '-', 'g')),
      58
    ) AS base_raw
  FROM forum_questions
  WHERE slug IS NULL
    AND deleted_at IS NULL
),
based AS (
  SELECT
    id,
    created_at,
    CASE
      WHEN base_raw = '' THEN 'question-' || left(replace(id::text, '-', ''), 8)
      ELSE base_raw
    END AS base_slug,
    (base_raw = '') AS was_empty
  FROM raw
),
numbered AS (
  SELECT
    id,
    base_slug,
    ROW_NUMBER() OVER (
      PARTITION BY CASE WHEN was_empty THEN id::text ELSE base_slug END
      ORDER BY created_at NULLS LAST, id
    ) AS rn
  FROM based
)
UPDATE forum_questions q
SET slug = CASE WHEN n.rn = 1 THEN n.base_slug ELSE n.base_slug || n.rn::text END
FROM numbered n
WHERE q.id = n.id;

CREATE UNIQUE INDEX IF NOT EXISTS forum_questions_slug_unique_idx
  ON forum_questions (slug)
  WHERE deleted_at IS NULL AND slug IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Extend slug_redirects to cover renamed/retired question slugs.
--    CHECK constraints can't be altered in place — drop + recreate with the
--    added value. Name matches Postgres's default auto-generated name for
--    the unnamed CHECK in 0012_slugs_and_referrals.sql.
-- ---------------------------------------------------------------------

ALTER TABLE slug_redirects DROP CONSTRAINT IF EXISTS slug_redirects_entity_type_check;
ALTER TABLE slug_redirects ADD CONSTRAINT slug_redirects_entity_type_check
  CHECK (entity_type IN ('room', 'game', 'forum_question'));

-- ---------------------------------------------------------------------
-- 4. Seed the category taxonomy (structural/reference data, not sample
--    content — always present, unlike the optional db/seed.sql content
--    seed). Fixed ids so db/seed.sql can reference them directly.
-- ---------------------------------------------------------------------

INSERT INTO forum_categories (id, slug, name, description, icon_emoji, sort_order) VALUES
  ('00000000-0000-0000-0006-000000000001', 'general',        'General',              'Anything and everything — start here if you''re not sure where else it fits.', '💬', 0),
  ('00000000-0000-0000-0006-000000000002', 'relationships',  'Relationships & Dating','Love, friendship, family, and everything in between.',                       '❤️', 1),
  ('00000000-0000-0000-0006-000000000003', 'money-business', 'Money & Business',      'Side hustles, investing, careers, and building something of your own.',      '💰', 2),
  ('00000000-0000-0000-0006-000000000004', 'tech',           'Tech & Gadgets',        'Phones, apps, the internet, and everything digital.',                        '🖥️', 3),
  ('00000000-0000-0000-0006-000000000005', 'school-career',  'School & Career',       'Studying, exams, job hunting, and figuring out what''s next.',               '🎓', 4),
  ('00000000-0000-0000-0006-000000000006', 'entertainment',  'Entertainment & Culture','Music, movies, celebrity gist, and pop culture.',                            '🎵', 5),
  ('00000000-0000-0000-0006-000000000007', 'sports',         'Sports',               'Football, basketball, and everything competitive.',                          '🏆', 6),
  ('00000000-0000-0000-0006-000000000008', 'health',         'Health & Wellness',     'Fitness, mental health, and taking care of yourself.',                       '🌱', 7)
ON CONFLICT (id) DO NOTHING;
