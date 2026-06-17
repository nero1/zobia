-- Migration 0007: Drop stale global/under-scoped unique indexes on ledger tables
--
-- Several unique indexes were created in migration 0001 without including user_id
-- (or without including enough columns to scope dedup per-user). Later migrations
-- added correct per-user replacements but never dropped the originals, leaving
-- ghost constraints that fire duplicate-key errors as soon as a second user
-- performs the same action.
--
-- coin_ledger
-- -----------
-- uidx_coin_ledger_type_ref      (transaction_type, reference_id)
--   → replaced by uidx_coin_ledger_tx_type_ref (user_id, transaction_type, reference_id)
--     added in migration 0006
--
-- idx_coin_ledger_reference_id_unique  (reference_id)
--   → global uniqueness on reference_id alone; blocks any two users sharing
--     the same reference string (e.g. 'onboarding_welcome').
--     uidx_coin_ledger_tx_type_ref is the correct per-user dedup index.
--
-- star_ledger
-- -----------
-- uidx_star_ledger_type_ref      (transaction_type, reference_id)
--   → replaced by uidx_star_ledger_tx_type_ref (user_id, transaction_type, reference_id)
--     added in migration 0006
--
-- xp_ledger
-- ---------
-- idx_xp_ledger_user_reference   (user_id, reference_id)
--   → missing source column; a user receiving XP from two different sources
--     with the same reference_id would collide.
--     uidx_xp_ledger_source_ref (user_id, source, reference_id) added in
--     migration 0003 is the correct replacement.

DROP INDEX IF EXISTS uidx_coin_ledger_type_ref;
DROP INDEX IF EXISTS idx_coin_ledger_reference_id_unique;
DROP INDEX IF EXISTS uidx_star_ledger_type_ref;
DROP INDEX IF EXISTS idx_xp_ledger_user_reference;
