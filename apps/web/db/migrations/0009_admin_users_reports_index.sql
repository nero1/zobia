-- Migration 0009: missing index on reports.reported_user_id
--
-- Root cause of the /gate44/users "Failed to load users" admin bug:
-- GET /api/admin/users (app/api/admin/users/route.ts) runs a correlated
-- subquery per row to count each user's report history:
--
--   (SELECT COUNT(*)::int FROM reports WHERE reported_user_id = u.id) AS report_count
--
-- Every OTHER correlated subquery on that endpoint is backed by an index
-- (idx_payments_user_id, idx_room_messages_sender, idx_rooms_creator_id —
-- all added in 0001_consolidated_schema.sql), but reports.reported_user_id
-- was never indexed even though idx_reports_reporter (on reporter_id) was.
-- EXPLAIN confirms a full sequential scan on `reports` for this filter.
--
-- With a non-trivial reports table (exactly what accumulates on a working
-- moderation system) this scan runs once per row returned (up to 21x per
-- page) and can exceed the 10s `statement_timeout` set on the DB pool
-- (see lib/db/providers/*.ts), causing Postgres to cancel the query and the
-- route to throw -> 500 -> the admin UI's "Failed to load users" error.
-- The same missing index also slows app/api/admin/moderation/[reportId]/
-- route.ts's per-report history lookup and app/api/cron/daily-social/route.ts.

CREATE INDEX IF NOT EXISTS idx_reports_reported_user_id
  ON reports (reported_user_id)
  WHERE reported_user_id IS NOT NULL;
