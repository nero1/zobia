-- Migration 0034: Composite index to support keyset-paginated notification
-- listing (WHERE user_id = $1 [AND created_at < $2] ORDER BY created_at DESC).
--
-- The existing idx_notifications_user_id and idx_notifications_created_at
-- indexes are single-column, so Postgres would need a bitmap AND (or a full
-- index scan) to serve this query efficiently at scale. This composite index
-- lets it satisfy the filter and sort in one index scan.

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);
