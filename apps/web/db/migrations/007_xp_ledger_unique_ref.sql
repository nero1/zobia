-- 007_xp_ledger_unique_ref.sql
-- Adds a partial unique index on xp_ledger (user_id, reference_id) where reference_id IS NOT NULL.
-- Prevents duplicate XP awards for the same event (already used ON CONFLICT DO NOTHING in code).

CREATE UNIQUE INDEX IF NOT EXISTS idx_xp_ledger_user_reference
  ON xp_ledger (user_id, reference_id)
  WHERE reference_id IS NOT NULL;
