-- BUG-IDEM-01 FIX: add a unique partial index on messages(sender_id, idempotency_key)
-- so the database enforces DM idempotency atomically.
--
-- Without this, the pre-INSERT idempotency SELECT in dm/route.ts is a non-atomic
-- TOCTOU check: two concurrent requests with the same idempotencyKey both pass the
-- guard and both INSERT, charging the sender twice and creating duplicate messages.
--
-- WHERE idempotency_key IS NOT NULL ensures only keyed messages are constrained;
-- messages sent without an idempotency key (legacy / non-client-controlled) are
-- unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_idempotency_key_uq
  ON messages (sender_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
