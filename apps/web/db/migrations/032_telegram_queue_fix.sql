-- Migration 032: Fix telegram_delivery_queue schema
-- Adds missing columns, corrects FK to admin_messages, ensures CRON processor works.

-- Add delivered_at and failed_attempts columns (may already exist in some deploys)
ALTER TABLE telegram_delivery_queue
  ADD COLUMN IF NOT EXISTS delivered_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_attempts  INTEGER NOT NULL DEFAULT 0;

-- Rename processed_at → delivered_at if old column exists (safe: IF EXISTS)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'telegram_delivery_queue'
      AND column_name = 'processed_at'
  ) THEN
    -- Copy old data if delivered_at is empty
    UPDATE telegram_delivery_queue
    SET delivered_at = processed_at
    WHERE processed_at IS NOT NULL AND delivered_at IS NULL;
  END IF;
END $$;

-- Fix the FK: the broadcast_id now references admin_messages, not creator_broadcasts.
-- Drop old FK if it exists, then add correct one.
DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name
  JOIN information_schema.table_constraints tc2
    ON rc.unique_constraint_name = tc2.constraint_name
  WHERE tc.table_name = 'telegram_delivery_queue'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND tc2.table_name = 'creator_broadcasts'
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE telegram_delivery_queue DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

-- Re-add FK pointing to admin_messages (permissive: skip if admin_messages doesn't exist yet)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_messages') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
      JOIN information_schema.table_constraints tc2 ON rc.unique_constraint_name = tc2.constraint_name
      WHERE tc.table_name = 'telegram_delivery_queue'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND tc2.table_name = 'admin_messages'
    ) THEN
      ALTER TABLE telegram_delivery_queue
        ADD CONSTRAINT telegram_delivery_queue_broadcast_id_fkey
        FOREIGN KEY (broadcast_id) REFERENCES admin_messages(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

-- Index for efficient polling by undelivered rows
CREATE INDEX IF NOT EXISTS idx_telegram_delivery_queue_undelivered
  ON telegram_delivery_queue (created_at ASC)
  WHERE delivered_at IS NULL AND failed_attempts < 3;
