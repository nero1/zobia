-- Migration 0005: SCHEMA-SEASON-01 — Consolidate duplicate season-pass tables
--
-- Removes two redundant tables that were causing ambiguity in the season pass
-- and milestone claim subsystems:
--
--   season_passes           — never read or written by any application code;
--                             user_season_passes is the canonical ownership table.
--
--   user_season_pass_claims — had a broken unique key (user_id, milestone_id)
--                             that prevented claiming the same milestone across
--                             seasons; superseded by user_season_milestone_claims
--                             whose key correctly includes season_id.
--
-- All reads and writes now go through:
--   user_season_passes           (pass ownership, XP, rank)
--   user_season_milestone_claims (milestone claim tracking)
--
-- Take a full DB backup before applying.

BEGIN;

-- ============================================================
-- Migrate any orphaned rows from the old claims table into the
-- canonical table. ON CONFLICT DO NOTHING is safe here because
-- the unique key on user_season_milestone_claims includes
-- (user_id, season_id, milestone_id) — a superset of what the
-- old table tracked — so every valid old row maps to exactly
-- one slot in the new table.
-- ============================================================
INSERT INTO user_season_milestone_claims
  (user_id, season_id, milestone_id, claimed_at)
SELECT
  uspc.user_id,
  uspc.season_id,
  uspc.milestone_id,
  uspc.claimed_at
FROM user_season_pass_claims uspc
ON CONFLICT (user_id, season_id, milestone_id) DO NOTHING;

-- ============================================================
-- Drop the superseded claims table (after data is migrated)
-- ============================================================
DROP TABLE IF EXISTS user_season_pass_claims;

-- ============================================================
-- Drop the unused legacy pass template table
-- ============================================================
DROP TABLE IF EXISTS season_passes;

COMMIT;
