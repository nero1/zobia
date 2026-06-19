-- =====================================================================
-- 0012_slugs_and_referrals.sql
--
-- SEO-friendly public URLs + cross-platform referral attribution.
--
-- Scheme:
--   /u/<username>      public profile   (already served by username — no change)
--   /r/<room-slug>     public room
--   /c/<course-slug>   classroom / course (a room of type 'classroom')
--   /g/<game-slug>     game (upcoming feature — table created here)
--
-- Design: the UUID primary key stays the immutable internal reference; the
-- slug is a mutable, unique, human-facing alias. Old slugs (and legacy
-- /r/<uuid> links) keep working via `slug_redirects` + UUID fallback in the
-- route handler.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Rooms get a slug column
-- ---------------------------------------------------------------------
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS slug text;

-- ---------------------------------------------------------------------
-- 2. Backfill slugs for existing rooms.
--    base slug = lowercased name with non-alphanumerics collapsed to '-'.
--    Duplicates within the same base get a numeric suffix with no separator
--    ("dorcas-cuisine", "dorcas-cuisine2", "dorcas-cuisine3"), ordered by
--    created_at so the oldest room keeps the bare slug.
-- ---------------------------------------------------------------------
WITH raw AS (
  SELECT
    id,
    created_at,
    -- Trim to 58 chars to leave room for a numeric suffix within the 60 cap.
    left(
      trim(BOTH '-' FROM regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', '-', 'g')),
      58
    ) AS base_raw
  FROM rooms
  WHERE slug IS NULL
    AND deleted_at IS NULL
),
based AS (
  SELECT
    id,
    created_at,
    CASE
      WHEN base_raw = '' THEN 'room-' || left(replace(id::text, '-', ''), 8)
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
      -- All-empty names are made unique by id already, so never collide them.
      PARTITION BY CASE WHEN was_empty THEN id::text ELSE base_slug END
      ORDER BY created_at NULLS LAST, id
    ) AS rn
  FROM based
)
UPDATE rooms r
SET slug = CASE WHEN n.rn = 1 THEN n.base_slug ELSE n.base_slug || n.rn::text END
FROM numbered n
WHERE r.id = n.id;

-- ---------------------------------------------------------------------
-- 3. Enforce uniqueness for live rooms (soft-deleted rooms release their slug).
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS rooms_slug_unique_idx
  ON rooms (slug)
  WHERE deleted_at IS NULL AND slug IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. Games table (upcoming feature). Created now so the /g/<slug> public
--    route, sitemap entries and referral links have a real backing table.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS games (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL,
  name            text NOT NULL,
  tagline         text,
  description     text,
  cover_image_url text,
  cover_emoji     text NOT NULL DEFAULT '🎮',
  creator_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  is_public       boolean NOT NULL DEFAULT true,
  is_active       boolean NOT NULL DEFAULT true,
  play_count      bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  deleted_at      timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS games_slug_unique_idx
  ON games (slug)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- 5. Slug redirect history. When a room/game slug changes, the previous slug
--    is recorded here so old links 301 to the current slug instead of 404ing.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS slug_redirects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('room', 'game')),
  old_slug    text NOT NULL,
  entity_id   uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, old_slug)
);

CREATE INDEX IF NOT EXISTS slug_redirects_entity_idx
  ON slug_redirects (entity_type, entity_id);

-- ---------------------------------------------------------------------
-- 6. Point the deep-link base URL at the active domain. zobia.social is
--    retired; the app is developed at zobia.vercel.app and will switch to
--    zobia.org as a custom domain later (update this key when it goes live).
-- ---------------------------------------------------------------------
UPDATE x_manifest
SET value = '"https://zobia.vercel.app"', updated_at = NOW()
WHERE key = 'deep_link_base_url'
  AND value = '"https://zobia.social"';
