-- 0009_push_preferences.sql
--
-- Per-category chat push toggles. Users can independently mute pushes for:
--   - DMs                  -> reuses existing users.dm_notifications
--   - Group chat messages  -> group_notifications (new)
--   - Room @mentions       -> room_mention_notifications (new)
--
-- The push sender (lib/notifications/chatPush.ts) checks the relevant column
-- before sending, in addition to the online/idle check. Defaults ON so existing
-- users keep receiving pushes. Idempotent via IF NOT EXISTS.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS group_notifications        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS room_mention_notifications BOOLEAN NOT NULL DEFAULT TRUE;
