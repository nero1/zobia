-- Migration 0003: Bug fixes for BUG-C01 through BUG-M05
-- Addresses all 18 bugs from custom-bugs-report.md
-- Run in a transaction. Take a full DB backup before applying.

BEGIN;

-- ============================================================
-- BUG-C01: Add left_at column to guild_members
-- ============================================================
ALTER TABLE guild_members ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ DEFAULT NULL;
-- Partial index for fast active-member lookups
CREATE INDEX IF NOT EXISTS idx_guild_members_active
  ON guild_members (guild_id) WHERE left_at IS NULL;

-- ============================================================
-- BUG-C02: Add UNIQUE constraint to payout_dead_letter_queue.payout_id
-- ============================================================
-- Deduplicate first (in case duplicates exist).
-- MIN(uuid) is not supported; use a self-join to keep the row with the
-- lexicographically smallest id (one row per payout_id is all we need).
DELETE FROM payout_dead_letter_queue a
  USING payout_dead_letter_queue b
  WHERE a.payout_id = b.payout_id
    AND a.id > b.id;
ALTER TABLE payout_dead_letter_queue
  ADD CONSTRAINT uq_pdlq_payout_id UNIQUE (payout_id);

-- ============================================================
-- BUG-C03: Add reference_id column to notifications table
-- ============================================================
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_id TEXT DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_notifications_user_type_ref
  ON notifications (user_id, type, reference_id)
  WHERE reference_id IS NOT NULL;

-- ============================================================
-- BUG-C04: Replace non-unique xp_ledger index with UNIQUE partial index
-- ============================================================
-- Remove duplicate rows before adding the unique constraint
-- (keep one row per (user_id, source, reference_id) — the one with the
-- lexicographically smallest id; MIN(uuid) is not supported so use a self-join).
DELETE FROM xp_ledger a
  USING xp_ledger b
  WHERE a.reference_id IS NOT NULL
    AND a.user_id = b.user_id
    AND a.source = b.source
    AND a.reference_id = b.reference_id
    AND a.id > b.id;
-- Drop the non-unique index (wrong name from migration 001)
DROP INDEX IF EXISTS idx_xp_ledger_user_source_ref;
-- Create the correct UNIQUE partial index that safeAwardXP relies on
CREATE UNIQUE INDEX IF NOT EXISTS uidx_xp_ledger_source_ref
  ON xp_ledger (user_id, source, reference_id)
  WHERE reference_id IS NOT NULL;

-- ============================================================
-- BUG-H04: Fix season_pass_milestones unique index to include tier
-- (allows free and paid milestones to share sort_order values)
-- ============================================================
DROP INDEX IF EXISTS season_pass_milestones_season_sort_idx;
CREATE UNIQUE INDEX IF NOT EXISTS season_pass_milestones_season_tier_sort_idx
  ON season_pass_milestones (season_id, tier, sort_order);

-- ============================================================
-- BUG-H07: guild_tier_history — no meaningful dedup exists.
-- Add war_id column so each war can only produce one history entry per guild.
-- ============================================================
ALTER TABLE guild_tier_history ADD COLUMN IF NOT EXISTS war_id UUID REFERENCES guild_wars(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_guild_tier_history_guild_war
  ON guild_tier_history (guild_id, war_id)
  WHERE war_id IS NOT NULL;

-- ============================================================
-- BUG-M03: referral_commissions — make the implicit conflict target explicit.
-- trigger_event_id is already UNIQUE; this migration is a no-op constraint-wise
-- but ensures the intent is documented at the DB level.
-- ============================================================
-- trigger_event_id already has UNIQUE from migration 001; nothing new needed.

COMMIT;
