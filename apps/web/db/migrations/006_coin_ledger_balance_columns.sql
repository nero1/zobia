-- Migration 006: Ensure balance_before and balance_after exist on coin_ledger
-- These columns are required by getLedgerEntries() in lib/economy/coins.ts.
-- They were defined in 001_complete_schema.sql but may be absent in databases
-- provisioned from an older schema snapshot.

ALTER TABLE coin_ledger
  ADD COLUMN IF NOT EXISTS balance_before BIGINT NOT NULL DEFAULT 0;

ALTER TABLE coin_ledger
  ADD COLUMN IF NOT EXISTS balance_after BIGINT NOT NULL DEFAULT 0;
