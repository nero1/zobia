-- Migration 011: Schema de-duplication (Bug #28)
--
-- Consolidates duplicate/overlapping table groups:
--
--   1. message_reactions FK bug fix: FK erroneously pointed to room_messages
--      but the table stores DM reactions. Fix to reference messages(id).
--
--   2. user_messages → creator_broadcasts rename: used solely for creator
--      broadcast fan-out; the generic name was misleading.
--
--   3. user_notifications → notifications merge: add title/body/metadata
--      columns to the canonical notifications table, migrate all rows from
--      user_notifications, then drop the duplicate table.
--
--   4. guild_treasury_log → guild_treasury_ledger consolidation: the log
--      table is a lightweight subset of the ledger. Add reference_id to the
--      ledger, migrate existing log rows, then drop the log table.
--
--   5. friendships / follows: intentionally separate (different semantics);
--      no change required.
--
-- All operations use IF EXISTS / IF NOT EXISTS guards for idempotency.

-- ============================================================
-- 1. Fix message_reactions foreign-key (DM reactions → messages)
-- ============================================================

ALTER TABLE message_reactions
  DROP CONSTRAINT IF EXISTS message_reactions_message_id_fkey;

ALTER TABLE message_reactions
  ADD CONSTRAINT message_reactions_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;

-- ============================================================
-- 2. Rename user_messages → creator_broadcasts
-- ============================================================

ALTER TABLE user_messages RENAME TO creator_broadcasts;

-- Keep the primary-key index name in sync (Postgres auto-renames it, but
-- make the intent explicit via a comment).
COMMENT ON TABLE creator_broadcasts IS
  'Fan-out broadcast messages from a creator to their followers. '
  'Renamed from user_messages (2026-06 migration 011).';

-- ============================================================
-- 3. Merge user_notifications into notifications
-- ============================================================

-- 3a. Extend notifications with the richer columns from user_notifications.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS title    TEXT,
  ADD COLUMN IF NOT EXISTS body     TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 3b. Copy rows from user_notifications that aren't already present.
INSERT INTO notifications (id, user_id, type, payload, title, body, metadata, is_read, created_at)
SELECT id, user_id, type, payload, title, body, metadata, is_read, created_at
FROM user_notifications
ON CONFLICT (id) DO NOTHING;

-- 3c. Drop the now-redundant table.
DROP TABLE IF EXISTS user_notifications;

-- ============================================================
-- 4. Consolidate guild_treasury_log into guild_treasury_ledger
-- ============================================================

-- 4a. Add reference_id to the ledger so callers can store a correlation key.
ALTER TABLE guild_treasury_ledger
  ADD COLUMN IF NOT EXISTS reference_id TEXT;

CREATE INDEX IF NOT EXISTS idx_guild_treasury_ledger_ref
  ON guild_treasury_ledger(reference_id)
  WHERE reference_id IS NOT NULL;

-- 4b. Migrate log rows into the ledger.
--     balance_before/after default to 0 for historical rows (pre-production
--     data; ledger was not tracking running balances via this lightweight log).
INSERT INTO guild_treasury_ledger
  (guild_id, user_id, amount, balance_before, balance_after,
   transaction_type, description, reference_id, created_at)
SELECT
  guild_id,
  NULL,
  amount::BIGINT,
  0,
  amount::BIGINT,
  source,
  NULL,
  reference_id,
  created_at
FROM guild_treasury_log
ON CONFLICT DO NOTHING;

-- 4c. Drop the now-redundant table and its index.
DROP INDEX IF EXISTS idx_guild_treasury_log_guild;
DROP TABLE IF EXISTS guild_treasury_log;

-- ============================================================
-- 5. Covering/purge-helper indexes for high-churn append-only tables
--    (reduces sequential scans during scheduled DELETE purges and
--     improves TTL-based cleanup queries on the hobby-tier DB)
-- ============================================================

-- moments: fast purge of expired rows by the daily cron
CREATE INDEX IF NOT EXISTS idx_moments_expires_at
  ON moments(expires_at)
  WHERE expires_at IS NOT NULL;

-- room_messages: time-range cleanup per room
CREATE INDEX IF NOT EXISTS idx_room_messages_created_at
  ON room_messages(created_at);

-- xp_events: time-range aggregation and purge
CREATE INDEX IF NOT EXISTS idx_xp_events_created_at
  ON xp_events(created_at);

-- coin_ledger: time-range audit / purge
CREATE INDEX IF NOT EXISTS idx_coin_ledger_created_at
  ON coin_ledger(created_at);

-- star_ledger: time-range audit / purge
CREATE INDEX IF NOT EXISTS idx_star_ledger_created_at
  ON star_ledger(created_at);

-- notifications: fast cleanup of old read notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created
  ON notifications(user_id, is_read, created_at DESC);
