-- Migration 0007: Drop stale global unique index on coin_ledger
--
-- Migration 0001 created uidx_coin_ledger_type_ref on (transaction_type, reference_id)
-- without user_id, making the reference_id globally unique across all users.
-- Migration 0006 fixed the per-user dedup index (uidx_coin_ledger_tx_type_ref) but
-- never dropped this original index. The result: a second user completing onboarding
-- (or any other operation sharing the same reference_id string) gets a 23505 duplicate
-- key error against this stale constraint.
-- The correct per-user dedup index (uidx_coin_ledger_tx_type_ref) already exists on
-- (user_id, transaction_type, reference_id), so this one is safe to drop.

DROP INDEX IF EXISTS uidx_coin_ledger_type_ref;
