-- Migration 002: Add missing columns referenced in API routes

-- rooms: add duration_minutes for 'limited' room type
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

-- rooms: update type check constraint to include 'limited'
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_type_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_type_check
  CHECK (type IN ('free_open','vip','drop','tipping','classroom','guild','limited'));

-- subscriptions: add cancelled_at for cancel flow tracking
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
