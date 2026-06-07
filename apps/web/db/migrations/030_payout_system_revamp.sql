-- Migration 030: Creator Payout System Revamp
--
-- Replaces the custom KYC system with:
--   - Nigerian bank account verification via Paystack Resolve Account API
--   - USDT/Tron wallet addresses for global creators
--   - Enhanced creator_payouts table with method, region, snapshot, and retry fields
--   - Dead-letter queue for failed payouts
--   - New x_manifest keys for payout configuration
--
-- Safe to re-run: all statements use IF (NOT) EXISTS or ON CONFLICT DO NOTHING.

-- ─── 1. Nigerian bank accounts ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS creator_bank_accounts (
  id                    UUID        NOT NULL DEFAULT gen_random_uuid(),
  creator_id            UUID        NOT NULL,
  bank_name             TEXT        NOT NULL,
  bank_code             TEXT        NOT NULL,
  account_number        TEXT        NOT NULL,  -- AES-256-GCM encrypted
  account_name          TEXT        NOT NULL,  -- from Paystack Resolve Account API
  account_number_last4  TEXT        NOT NULL,  -- display only, never encrypted
  recipient_code        TEXT,                  -- Paystack Transfer Recipient code
  xp_awarded            BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT creator_bank_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT creator_bank_accounts_creator_id_fkey
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT creator_bank_accounts_creator_id_unique UNIQUE (creator_id)
);

CREATE INDEX IF NOT EXISTS idx_creator_bank_accounts_creator
  ON creator_bank_accounts (creator_id);

-- ─── 2. Global USDT/Tron wallet addresses ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS creator_wallet_addresses (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  creator_id  UUID        NOT NULL,
  network     TEXT        NOT NULL DEFAULT 'tron',
  currency    TEXT        NOT NULL DEFAULT 'USDT',
  address     TEXT        NOT NULL,  -- AES-256-GCM encrypted
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT creator_wallet_addresses_pkey PRIMARY KEY (id),
  CONSTRAINT creator_wallet_addresses_creator_id_fkey
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT creator_wallet_addresses_creator_id_unique UNIQUE (creator_id)
);

CREATE INDEX IF NOT EXISTS idx_creator_wallet_addresses_creator
  ON creator_wallet_addresses (creator_id);

-- ─── 3. Dead-letter queue for failed payouts ──────────────────────────────────

CREATE TABLE IF NOT EXISTS payout_dead_letter_queue (
  id                UUID        NOT NULL DEFAULT gen_random_uuid(),
  payout_id         UUID        NOT NULL,
  creator_id        UUID        NOT NULL,
  failure_reason    TEXT,
  retry_count       INTEGER     NOT NULL DEFAULT 0,
  last_attempted_at TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  resolution_note   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payout_dead_letter_queue_pkey PRIMARY KEY (id),
  CONSTRAINT payout_dlq_payout_id_fkey
    FOREIGN KEY (payout_id) REFERENCES creator_payouts(id),
  CONSTRAINT payout_dlq_creator_id_fkey
    FOREIGN KEY (creator_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_payout_dlq_unresolved
  ON payout_dead_letter_queue (created_at DESC)
  WHERE resolved_at IS NULL;

-- ─── 4. Extend creator_payouts ────────────────────────────────────────────────

-- payout method: bank_transfer (Nigeria auto/manual), coins (all regions),
--                crypto (USDT/Tron, all regions — manual only for global)
ALTER TABLE creator_payouts
  ADD COLUMN IF NOT EXISTS payout_method TEXT DEFAULT 'bank_transfer'
    CHECK (payout_method IN ('bank_transfer', 'coins', 'crypto'));

-- region: determines which manifest flags and approval logic apply
ALTER TABLE creator_payouts
  ADD COLUMN IF NOT EXISTS region TEXT DEFAULT 'nigeria'
    CHECK (region IN ('nigeria', 'global'));

-- snapshot of bank account at the moment the payout was requested
-- (prevents account changes from affecting in-flight payouts)
ALTER TABLE creator_payouts
  ADD COLUMN IF NOT EXISTS bank_account_snapshot JSONB;

-- encrypted snapshot of wallet address at the moment of request
ALTER TABLE creator_payouts
  ADD COLUMN IF NOT EXISTS wallet_address_snapshot TEXT;

-- retry tracking for the payout CRON
ALTER TABLE creator_payouts
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE creator_payouts
  ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ;

ALTER TABLE creator_payouts
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- appeal pipeline for rejected payouts
ALTER TABLE creator_payouts
  ADD COLUMN IF NOT EXISTS appeal_reason TEXT;

ALTER TABLE creator_payouts
  ADD COLUMN IF NOT EXISTS appeal_status TEXT
    CHECK (appeal_status IN ('pending', 'resolved', 'dismissed'));

ALTER TABLE creator_payouts
  ADD COLUMN IF NOT EXISTS appeal_submitted_at TIMESTAMPTZ;

ALTER TABLE creator_payouts
  ADD COLUMN IF NOT EXISTS appeal_resolved_at TIMESTAMPTZ;

ALTER TABLE creator_payouts
  ADD COLUMN IF NOT EXISTS appeal_resolved_by UUID
    REFERENCES users(id);

-- Extend status enum to include 'cancelled'
-- Drop and re-add the CHECK constraint (PostgreSQL requires this approach)
ALTER TABLE creator_payouts
  DROP CONSTRAINT IF EXISTS creator_payouts_status_check;

ALTER TABLE creator_payouts
  ADD CONSTRAINT creator_payouts_status_check
    CHECK (status IN (
      'pending', 'awaiting_approval', 'processing',
      'completed', 'failed', 'rejected', 'reversed', 'cancelled'
    ));

-- Index to speed up CRON payout processing queries
CREATE INDEX IF NOT EXISTS idx_creator_payouts_pending_bank
  ON creator_payouts (created_at ASC)
  WHERE status = 'pending' AND payout_method = 'bank_transfer';

CREATE INDEX IF NOT EXISTS idx_creator_payouts_retry
  ON creator_payouts (next_retry_at ASC)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;

-- ─── 5. New x_manifest configuration keys ─────────────────────────────────────

INSERT INTO x_manifest (key, value, description) VALUES
  ('payouts_enabled',                'true',  'Master toggle: enable/disable all creator payouts'),
  ('nigeria_cash_payout_enabled',    'true',  'Nigeria: enable bank transfer payouts via Paystack'),
  ('nigeria_coins_payout_enabled',   'true',  'Nigeria: enable coin-based payouts'),
  ('nigeria_crypto_payout_enabled',  'true',  'Nigeria: enable USDT/Tron crypto payouts'),
  ('global_coins_payout_enabled',    'true',  'Global: enable coin-based payouts'),
  ('global_crypto_payout_enabled',   'true',  'Global: enable USDT/Tron crypto payouts (manual only)'),
  ('nigeria_payout_auto_approve',    'true',  'Nigeria bank transfers: true=auto, false=all require manual admin approval'),
  ('payout_batch_size',              '200',   'Max number of payouts processed per CRON run (default 200)'),
  ('payout_max_retries',             '3',     'Max retry attempts before a payout is moved to dead-letter queue'),
  ('bank_account_first_add_xp',      '5',     'XP awarded to creator on first bank account addition'),
  ('bank_account_first_add_creator_xp', '10', 'Creator track XP awarded on first bank account addition')
ON CONFLICT (key) DO NOTHING;
