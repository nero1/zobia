-- Migration 012: Telegram login states, rooms.closes_at, users.dm_opt_out, users.prestige_count
-- Run this migration after 011_missing_tables_2.sql

-- ---------------------------------------------------------------------------
-- telegram_login_states: tracks mobile Telegram login state tokens
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS telegram_login_states (
  state          VARCHAR(64) PRIMARY KEY,
  status         VARCHAR(16) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'expired')),
  token          TEXT,
  user_payload   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_login_states_created_at
  ON telegram_login_states (created_at);

-- Auto-cleanup: delete states older than 10 minutes (handled by CRON, index aids it)

-- ---------------------------------------------------------------------------
-- rooms.drop_ends_at: Drop Rooms need a scheduled close time (if not already present)
-- (The initial schema may already have this; ADD COLUMN IF NOT EXISTS is safe)
-- ---------------------------------------------------------------------------

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS drop_ends_at TIMESTAMPTZ;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS drop_starts_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- users.dm_opt_out: global DM opt-out flag
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS dm_opt_out BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- users.prestige_count: track total prestige resets for Elder eligibility
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS prestige_count INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- users.last_login_date: used by streak logic in daily CRON
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login_date DATE;

-- ---------------------------------------------------------------------------
-- RLS on telegram_login_states: only service role can read/write
-- ---------------------------------------------------------------------------

ALTER TABLE telegram_login_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY telegram_login_states_service_only ON telegram_login_states
  USING (false)
  WITH CHECK (false);
