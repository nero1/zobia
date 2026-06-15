-- =============================================================================
-- Migration 012: Session bug fixes
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS / DO $$ ... $$ guards.
--
-- Fixes: BUG-03/BUG-30 (seasons.updated_at), BUG-07 (room_subscriptions UNIQUE),
--        BUG-08 (season_pass_milestones UNIQUE), BUG-13 (referral_commissions.tier),
--        BUG-27 (failed_xp_awards partial unique index),
--        BUG-20 support (audit_discrepancies CHECK constraint broadened to allow 'xp')
-- =============================================================================

-- ---------------------------------------------------------------------------
-- BUG-03 / BUG-30: Add updated_at column to seasons table.
-- Two code paths (daily CRON + resetSeasonRankings) run
-- UPDATE seasons SET ... updated_at = NOW() but the column was absent from 001.
-- ---------------------------------------------------------------------------
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
UPDATE seasons SET updated_at = created_at WHERE updated_at IS NULL;

-- ---------------------------------------------------------------------------
-- BUG-07: Add UNIQUE constraint to room_subscriptions so the Paystack webhook's
-- ON CONFLICT (room_id, user_id) DO UPDATE succeeds.
-- Migration 001 creates the table without any UNIQUE constraint.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS room_subscriptions_room_user_idx
  ON room_subscriptions (room_id, user_id);

-- ---------------------------------------------------------------------------
-- BUG-08: Add UNIQUE index to season_pass_milestones so seedSeasonPassMilestones's
-- ON CONFLICT (season_id, sort_order) DO NOTHING succeeds.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS season_pass_milestones_season_sort_idx
  ON season_pass_milestones (season_id, sort_order);

-- ---------------------------------------------------------------------------
-- BUG-13: Add tier column to referral_commissions.
-- Only present in lib/db/migrations/009_bug_fixes.sql; missing from canonical chain.
-- ---------------------------------------------------------------------------
ALTER TABLE referral_commissions ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'standard';

-- ---------------------------------------------------------------------------
-- BUG-27: Add partial unique index to failed_xp_awards for the safeAwardXP
-- DLQ ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL.
-- Migration 005 adds a regular UNIQUE constraint; the partial index is additionally
-- required for the partial ON CONFLICT clause.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_failed_xp_reference_partial
  ON failed_xp_awards (user_id, source, reference_id)
  WHERE reference_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- BUG-20 support: Broaden audit_discrepancies asset_type CHECK constraint to
-- include 'xp'. Migration 005 only allows ('coins', 'stars') but the
-- reconcile-balances CRON inserts 'xp'.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'audit_discrepancies'::regclass
       AND conname   = 'audit_discrepancies_asset_type_check'
  ) THEN
    ALTER TABLE audit_discrepancies DROP CONSTRAINT audit_discrepancies_asset_type_check;
  END IF;
END $$;

ALTER TABLE audit_discrepancies
  ADD CONSTRAINT audit_discrepancies_asset_type_check
  CHECK (asset_type IN ('coins', 'stars', 'xp'));
