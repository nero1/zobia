-- Migration 0031: Add missing columns required by Drizzle schema
--
-- BUG-SCHEMA-01: sticker_packs.slug — referenced by claimPassMilestone
--   The Drizzle schema defines slug on stickerPacks but the initial SQL migration
--   never added it. Without this column the season-pass milestone claim for
--   sticker-pack rewards throws a column-not-found error.
--
-- BUG-SCHEMA-04: conversation_scores.created_at — referenced by inserts/queries
--   The Drizzle schema defines createdAt on conversationScores but the initial
--   SQL migration omits the column. Any insert or ORDER BY on created_at fails.

-- ---------------------------------------------------------------------------
-- BUG-SCHEMA-01: sticker_packs.slug
-- ---------------------------------------------------------------------------
ALTER TABLE sticker_packs
  ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;

-- Back-fill existing rows: derive slug from lower-cased name with spaces → hyphens.
UPDATE sticker_packs
   SET slug = LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g'))
 WHERE slug IS NULL;

-- ---------------------------------------------------------------------------
-- BUG-SCHEMA-04: conversation_scores.created_at
-- ---------------------------------------------------------------------------
ALTER TABLE conversation_scores
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
