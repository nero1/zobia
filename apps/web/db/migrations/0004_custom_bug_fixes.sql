-- Migration 0004: Custom bug fixes from custom-bugs-fix-plan.md
-- Addresses SCHEMA-XP-01, SCHEMA-STAR-01, SCHEMA-BANK-01, SCHEMA-DM-01,
-- SCHEMA-STREAK-01, CRON-NEMESIS-01, CRON-ALLIANCE-01, CRON-MONTHLY-01,
-- DB-INDEX-01, PUSH-RECEIPT-01, and CRON-STREAK-02.
-- Run in a transaction. Take a full DB backup before applying.

BEGIN;

-- ============================================================
-- SCHEMA-XP-01: x_manifest.value should be TEXT, not JSONB
-- ============================================================
-- Cast existing JSONB values to their text representation.
ALTER TABLE x_manifest
  ALTER COLUMN value TYPE TEXT USING value::text;

-- ============================================================
-- SCHEMA-STAR-01: star_ledger.amount should be BIGINT, not INTEGER
-- ============================================================
ALTER TABLE star_ledger
  ALTER COLUMN amount TYPE BIGINT USING amount::bigint;

-- ============================================================
-- SCHEMA-BANK-01: creator_bank_accounts — support multiple accounts
-- Remove the 1:1 unique constraint; add isPrimary + deletedAt;
-- add partial unique index for primary account per creator.
-- ============================================================
-- Remove the old unique constraint on creator_id
ALTER TABLE creator_bank_accounts
  DROP CONSTRAINT IF EXISTS creator_bank_accounts_creator_id_key;
-- Remove old unique index if it exists under a different name
DROP INDEX IF EXISTS creator_bank_accounts_creator_id_unique;
-- Add new columns
ALTER TABLE creator_bank_accounts
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
-- Migrate: set is_primary = TRUE for all existing single-account rows
UPDATE creator_bank_accounts
  SET is_primary = TRUE
  WHERE deleted_at IS NULL;
-- Add partial unique index: only one primary active account per creator
CREATE UNIQUE INDEX IF NOT EXISTS uidx_creator_bank_accounts_primary
  ON creator_bank_accounts (creator_id)
  WHERE is_primary = TRUE AND deleted_at IS NULL;

-- ============================================================
-- SCHEMA-DM-01: dm_conversations — enforce user_id_1 < user_id_2
-- ============================================================
-- Fix any existing rows that violate the ordering constraint
UPDATE dm_conversations
  SET user_id_1 = user_id_2,
      user_id_2 = user_id_1
  WHERE user_id_1 > user_id_2;
-- Remove duplicate conversations (keep the one with lower id)
DELETE FROM dm_conversations dc1
  USING dm_conversations dc2
  WHERE dc1.user_id_1 = dc2.user_id_1
    AND dc1.user_id_2 = dc2.user_id_2
    AND dc1.id > dc2.id;
-- Add CHECK constraint
ALTER TABLE dm_conversations
  ADD CONSTRAINT chk_dm_conversations_user_order
  CHECK (user_id_1 < user_id_2);

-- ============================================================
-- CRON-STREAK-02: Add last_login_date column (indexed date column)
-- for efficient streak calculations
-- ============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login_date DATE;
-- Backfill from last_login_at
UPDATE users
  SET last_login_date = last_login_at::date
  WHERE last_login_at IS NOT NULL AND last_login_date IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_last_login_date
  ON users (last_login_date)
  WHERE last_login_date IS NOT NULL;

-- ============================================================
-- SCHEMA-STREAK-01: Add longest_streak column to users
-- ============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS longest_streak INTEGER NOT NULL DEFAULT 0;
-- Backfill: set longest_streak to current login_streak_days for all users
UPDATE users
  SET longest_streak = GREATEST(longest_streak, COALESCE(login_streak_days, 0));

-- ============================================================
-- CRON-NEMESIS-01: Add last_notified_at to nemesis_assignments
-- ============================================================
ALTER TABLE nemesis_assignments
  ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_nemesis_assignments_last_notified
  ON nemesis_assignments (last_notified_at)
  WHERE is_active = TRUE;

-- ============================================================
-- CRON-ALLIANCE-01: Partial unique index on alliance_wars for active wars
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uidx_alliance_wars_active_pair
  ON alliance_wars (alliance_1_id, alliance_2_id)
  WHERE status = 'active';

-- ============================================================
-- CRON-MONTHLY-01: Partial unique index on coin_ledger for dedup
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uidx_coin_ledger_tx_type_ref
  ON coin_ledger (transaction_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- ============================================================
-- DB-INDEX-01: Partial index on creator_payouts for retry queue
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_creator_payouts_retry
  ON creator_payouts (next_retry_at)
  WHERE status IN ('pending', 'processing');

-- ============================================================
-- PUSH-RECEIPT-01: Add push_tickets table for two-stage push receipt polling
-- ============================================================
CREATE TABLE IF NOT EXISTS push_tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket_id   TEXT NOT NULL UNIQUE,             -- Expo push ticket ID from stage 1 (unique per send)
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | ok | error | device_not_registered
  receipt_id  TEXT,                             -- receipt ID returned at stage 2
  error_code  TEXT,                             -- error code from receipt (e.g. DeviceNotRegistered)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_at  TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_tickets_pending
  ON push_tickets (created_at)
  WHERE status = 'pending';

-- ============================================================
-- WEBHOOK-RETRY-01: Ensure failed_webhooks has necessary columns
-- ============================================================
ALTER TABLE failed_webhooks
  ADD COLUMN IF NOT EXISTS resolved       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS resolved_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retry_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error     TEXT,
  ADD COLUMN IF NOT EXISTS next_retry_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_failed_webhooks_retry
  ON failed_webhooks (next_retry_at)
  WHERE resolved = FALSE AND retry_count < 3;

COMMIT;
