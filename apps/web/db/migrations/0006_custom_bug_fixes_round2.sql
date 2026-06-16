-- Migration 0006: Custom bug fixes round 2 from custom-bugs-fix-plan.md
-- Addresses SYS-CL-ROOT, STAR-NOIDEM, and OFFLINE-IDEMP-GAP.
-- Run in a transaction. Take a full DB backup before applying.

BEGIN;

-- ============================================================
-- SYS-CL-ROOT: coin_ledger's dedup index (added in migration 0004 as
-- uidx_coin_ledger_tx_type_ref on (transaction_type, reference_id)) did not
-- include user_id. Two different users sharing the same (transaction_type,
-- reference_id) pair — e.g. a guild quest reward keyed only on questId, or a
-- season pass keyed only on seasonId — collided on this index, silently
-- dropping every credit/debit after the first user's. Recreate the index to
-- scope dedup per-user.
-- ============================================================
DROP INDEX IF EXISTS uidx_coin_ledger_tx_type_ref;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_coin_ledger_tx_type_ref
  ON coin_ledger (user_id, transaction_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- ============================================================
-- STAR-NOIDEM: star_ledger had no dedup index at all, so creditStars/
-- debitStars could not support ON CONFLICT-based idempotent retries the way
-- coin_ledger and xp_ledger do. Add the matching per-user partial unique index.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uidx_star_ledger_tx_type_ref
  ON star_ledger (user_id, transaction_type, reference_id)
  WHERE reference_id IS NOT NULL;

-- ============================================================
-- OFFLINE-IDEMP-GAP: room_messages had no idempotency_key column, so
-- offline-queued sends (Expo sync queue / PWA) replayed on reconnect could
-- create duplicate room messages. messages (DM/group) already has this
-- column with no extra index (lookups are scoped by sender_id + key, same
-- as the new room_messages check) — mirror that exactly for consistency.
-- ============================================================
ALTER TABLE room_messages
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

COMMIT;
