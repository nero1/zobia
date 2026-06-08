-- migration: 036_message_pin_expiry
-- Adds pin_expires_at to room_messages so the Message Pin power
-- (PRD §11 — 100 Coins, 1-hour duration) auto-expires.
-- Before this migration pins were permanent; now they expire
-- after the configured duration and the daily CRON clears them.

ALTER TABLE room_messages
  ADD COLUMN IF NOT EXISTS pin_expires_at TIMESTAMPTZ;

-- Backfill: existing pins that pre-date this column have no
-- expiry — treat them as permanent by leaving the column NULL.
-- Application code treats NULL as "no expiry" (legacy pin by
-- a room moderator, not purchased via the coin power).

-- Index to make the CRON unpin sweep fast.
CREATE INDEX IF NOT EXISTS idx_room_messages_pin_expiry
  ON room_messages (pin_expires_at)
  WHERE is_pinned = true AND pin_expires_at IS NOT NULL;
