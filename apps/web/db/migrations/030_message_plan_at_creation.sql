/**
 * 030_message_plan_at_creation.sql
 *
 * Add sender's plan context to messages at creation time for accurate message retention.
 * Ensures message history deletion uses the plan at message creation, not the sender's current plan.
 */

-- Add column to track sender's plan when message was created
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_plan_at_creation TEXT DEFAULT 'free';

-- Create index for efficient deletion queries
CREATE INDEX IF NOT EXISTS idx_messages_sender_plan_created
  ON messages(sender_plan_at_creation, created_at);
