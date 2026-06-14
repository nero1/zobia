-- 009_inactivity_notification_flags.sql
-- Splits the single shared `notified` flag on user_inactivity_events into
-- separate per-channel flags so push/email step and telegram step don't
-- consume each other's targets (BUG-CRON01).

ALTER TABLE user_inactivity_events
  ADD COLUMN IF NOT EXISTS push_email_notified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS telegram_notified   BOOLEAN NOT NULL DEFAULT FALSE;

-- Back-fill: treat existing notified=true rows as already sent via push/email
UPDATE user_inactivity_events
  SET push_email_notified = notified
  WHERE push_email_notified = FALSE AND notified = TRUE;

CREATE INDEX IF NOT EXISTS idx_inactivity_push_email_unnotified
  ON user_inactivity_events (user_id, created_at)
  WHERE push_email_notified = FALSE;

CREATE INDEX IF NOT EXISTS idx_inactivity_telegram_unnotified
  ON user_inactivity_events (user_id, created_at)
  WHERE telegram_notified = FALSE;
