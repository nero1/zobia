-- Migration 0027: Fix custom bugs (rankings_reset_at, messages idempotency,
--                  notification dedup, dm_conversations self-chat constraint,
--                  push_tickets pruning)
-- BUG-DB-01: Add rankings_reset_at column to seasons table
ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS rankings_reset_at TIMESTAMPTZ;

-- TASK-15 (BUG-MSG-01): Unique index on messages.idempotency_key for dedup
CREATE UNIQUE INDEX IF NOT EXISTS messages_idempotency_key_unique
  ON messages (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- TASK-16 (BUG-NOTIF-01): Partial unique index on user_notifications for dedup
-- Prevents duplicate system notifications of the same type when reference_id is NULL
CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_type_null_ref_unique
  ON user_notifications (user_id, type)
  WHERE reference_id IS NULL;

-- TASK-17 (BUG-DM-01): Prevent self-DM conversations at DB level
ALTER TABLE dm_conversations
  ADD CONSTRAINT dm_no_self_chat CHECK (user_a_id <> user_b_id);

-- TASK-20 (BUG-DB-02): Add created_at to push_tickets if missing for pruning CRON
ALTER TABLE push_tickets
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
