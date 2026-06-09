-- Migration 005: Add missing columns referenced by API routes

-- Add reward_pool_coins to seasons (used by GET /api/seasons)
ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS reward_pool_coins INTEGER NOT NULL DEFAULT 0;

-- Add is_read to messages (used by GET /api/messages/dm for unread count)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false;

-- Index to make the unread-count subquery fast
CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON messages (conversation_id, recipient_id, is_read, is_deleted)
  WHERE is_read = false AND is_deleted = false;
