-- Migration 010: Fix missing schema columns + add idempotency guards
-- Fixes Bugs #1, #2, #7, #8, #9, #19

-- Bug #1: star_ledger is missing balance_before/balance_after columns.
-- Every star credit/debit throws "column does not exist" → all star operations fail.
ALTER TABLE star_ledger
  ADD COLUMN IF NOT EXISTS balance_before BIGINT NOT NULL DEFAULT 0;

ALTER TABLE star_ledger
  ADD COLUMN IF NOT EXISTS balance_after BIGINT NOT NULL DEFAULT 0;

-- Allow TEXT reference_id on star_ledger for parity with coin_ledger
-- (some callers pass non-UUID strings)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'star_ledger' AND column_name = 'reference_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE star_ledger ALTER COLUMN reference_id TYPE TEXT USING reference_id::TEXT;
  END IF;
END $$;

-- Bug #2 / #9: payments table is missing amount_received_kobo.
-- All Paystack/Dodo charge.success webhooks throw on UPDATE → coins never credited.
-- Admin financial dashboard also fails on SUM(amount_received_kobo).
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS amount_received_kobo BIGINT;

-- Backfill completed payments so historical reports are correct
UPDATE payments
  SET amount_received_kobo = amount_kobo
  WHERE status = 'completed' AND amount_received_kobo IS NULL;

-- Bug #7 / #8: Non-idempotent earnings restoration → creator balances can be
-- double-credited when multiple paths (DLQ, webhook, reconciler) all restore.
-- Add a flag so restoration only ever happens once per payout.
ALTER TABLE creator_payouts
  ADD COLUMN IF NOT EXISTS earnings_restored BOOLEAN NOT NULL DEFAULT false;

-- Bug #19: coin_ledger has no uniqueness guard on (transaction_type, reference_id).
-- Webhook retries or internal retries can create duplicate ledger entries.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_coin_ledger_type_ref
  ON coin_ledger (transaction_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- Same guard for star_ledger
CREATE UNIQUE INDEX IF NOT EXISTS uidx_star_ledger_type_ref
  ON star_ledger (transaction_type, reference_id)
  WHERE reference_id IS NOT NULL;
