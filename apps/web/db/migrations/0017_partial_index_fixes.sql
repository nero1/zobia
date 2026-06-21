-- =====================================================================
-- 0017_partial_index_fixes.sql
--
-- BUG-NEM-01: Replace the non-partial UNIQUE(user_id, track, is_active)
--   constraint on nemesis_assignments with a partial unique index
--   on (user_id, track) WHERE is_active = TRUE.  The old constraint
--   allowed at most one *inactive* row per (user, track) pair, which
--   meant deactivated history rows would collide after a single
--   reassignment cycle.
--
-- BUG-CREA-01: Add a partial unique index on creator_earnings.reference_id
--   to prevent double-crediting if the creator fund CRON runs twice in the
--   same period.
--
-- BUG-RACE-01: Add a functional unique index on
--   rooms ((metadata->>'season_ceremony_id')) so the
--   ON CONFLICT ((metadata->>'season_ceremony_id')) DO NOTHING clause in
--   createSeasonCeremonyRoom works without throwing
--   "there is no unique constraint matching the ON CONFLICT specification".
--
-- All statements are idempotent (IF NOT EXISTS / DROP IF EXISTS).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- BUG-NEM-01: nemesis_assignments — swap non-partial unique for partial
-- ─────────────────────────────────────────────────────────────────────

-- Drop the old inline UNIQUE constraint (PostgreSQL auto-names it).
-- If it was already dropped or never existed, this is a no-op.
ALTER TABLE nemesis_assignments
  DROP CONSTRAINT IF EXISTS nemesis_assignments_user_id_track_is_active_key;

-- Create the correct partial unique index: only one active row per (user, track).
CREATE UNIQUE INDEX IF NOT EXISTS nemesis_assignments_active_idx
  ON nemesis_assignments (user_id, track)
  WHERE is_active = TRUE;

-- ─────────────────────────────────────────────────────────────────────
-- BUG-CREA-01: creator_earnings — partial unique on reference_id
-- ─────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS creator_earnings_reference_id_idx
  ON creator_earnings (reference_id)
  WHERE reference_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- BUG-RACE-01: rooms — functional unique on season_ceremony_id
-- ─────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS rooms_season_ceremony_id_idx
  ON rooms ((metadata->>'season_ceremony_id'))
  WHERE metadata->>'season_ceremony_id' IS NOT NULL;
