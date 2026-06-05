-- Migration 023: Flash XP scheduling + business subscription tracking
-- Adds announcement_notification_sent to flash_xp_events so the hourly CRON
-- can track whether the 6-hour advance push notification has been dispatched.
-- Also adds pending_tier / subscription_reference to business_accounts so that
-- tier upgrades are gated behind a completed payment.

-- Flash XP scheduling flag
ALTER TABLE flash_xp_events
  ADD COLUMN IF NOT EXISTS announcement_notification_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMPTZ;

-- Business account payment gating
ALTER TABLE business_accounts
  ADD COLUMN IF NOT EXISTS pending_tier        TEXT       CHECK (pending_tier IN ('starter','growth','enterprise')),
  ADD COLUMN IF NOT EXISTS pending_payment_ref TEXT,
  ADD COLUMN IF NOT EXISTS tier_updated_at     TIMESTAMPTZ;

-- Index for CRON queries
CREATE INDEX IF NOT EXISTS idx_flash_xp_events_announce
  ON flash_xp_events (announced_at, announcement_notification_sent, is_active);

CREATE INDEX IF NOT EXISTS idx_flash_xp_events_fires
  ON flash_xp_events (fires_at, fired, is_active);
