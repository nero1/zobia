-- Migration 0026: Fix outstanding bug gaps
--
-- BUG-10: Expression index required for the ceremony room ON CONFLICT clause.
--   ON CONFLICT ((metadata->>'season_ceremony_id')) requires a unique expression
--   index on rooms matching that exact expression. Without it PostgreSQL raises
--   "there is no unique constraint matching the ON CONFLICT specification".
--
-- BUG-47: Add retain_until column to messages table so the CRON cleanup
--   respects user/admin-set message retention windows.

-- BUG-10: Unique expression index for ceremony room idempotency guard.
CREATE UNIQUE INDEX IF NOT EXISTS rooms_ceremony_season_idx
  ON rooms ((metadata->>'season_ceremony_id'))
  WHERE metadata->>'season_ceremony_id' IS NOT NULL;

-- BUG-47: retain_until column for per-message retention policy.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS retain_until TIMESTAMPTZ DEFAULT NULL;

-- Index to speed up the CRON deletion query that filters on retain_until.
CREATE INDEX IF NOT EXISTS messages_retain_until_idx
  ON messages (retain_until)
  WHERE retain_until IS NOT NULL;
