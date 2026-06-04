-- Migration 016: Creator of the Month Spotlight
-- Adds the creator_spotlights table (PRD §25).
--
-- Columns:
--   id          - UUID primary key
--   creator_id  - FK to users(id); the spotlighted creator
--   month_year  - The spotlight month in YYYY-MM format (unique — one per month)
--   blurb       - Optional admin-written promo text shown on the Discover page
--   is_active   - True for the single currently-active spotlight
--   created_at  - Timestamp of record insertion
--   created_by  - FK to users(id); the admin who created the record

CREATE TABLE IF NOT EXISTS creator_spotlights (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_year  TEXT        NOT NULL,           -- e.g. '2025-06'
  blurb       TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID        REFERENCES users(id) ON DELETE SET NULL,

  -- Enforce one spotlight record per calendar month
  CONSTRAINT uq_creator_spotlight_month UNIQUE (month_year)
);

CREATE INDEX IF NOT EXISTS idx_creator_spotlights_creator   ON creator_spotlights(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_spotlights_is_active ON creator_spotlights(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_creator_spotlights_month     ON creator_spotlights(month_year DESC);
