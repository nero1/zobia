-- Migration 003: Add reply_to_message_id to room_messages
ALTER TABLE room_messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES room_messages(id) ON DELETE SET NULL;
