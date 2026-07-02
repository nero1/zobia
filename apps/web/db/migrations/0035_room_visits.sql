-- Migration 0035: Recently Visited Rooms
--
-- Backs the discovery page's new "Recently Visited" tab: room_visits records
-- the last-opened timestamp per user/room, upserted whenever a user opens a
-- room's detail (GET /api/rooms/[roomId]), powering a recency-ordered list
-- (most-recent-first).
--
-- Note: a "favorite a room" mechanism already exists as room_pins
-- (apps/web/db/migrations/0001_consolidated_schema.sql) with a full
-- pin/unpin API at /api/rooms/pinned (PRD §3 "Room Pins", tiered by plan).
-- The new "Faves" tab + heart icon reuse that existing table/endpoint rather
-- than duplicating it with a second favorites table.
--
-- room_visits is scoped to a small per-user working set (a handful of rows
-- per user in practice), so the "Recently Visited" tab reuses the discovery
-- feed's existing cursor pattern (ORDER BY ... LIMIT, cursor on the sort
-- column) rather than loading the whole set — this keeps it cheap even once
-- the platform has tens of thousands of rooms.

CREATE TABLE IF NOT EXISTS room_visits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  last_visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, room_id)
);

CREATE INDEX IF NOT EXISTS idx_room_visits_user_last_visited
  ON room_visits (user_id, last_visited_at DESC);

-- ---------------------------------------------------------------------------
-- RLS — same open-when-empty pattern as migration 0028 (service/CRON code
-- paths that don't set app.current_user_id keep working unchanged).
-- ---------------------------------------------------------------------------
ALTER TABLE room_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY room_visits_isolation ON room_visits
  FOR ALL
  USING (
    current_setting('app.current_user_id', TRUE) = ''
    OR user_id::text = current_setting('app.current_user_id', TRUE)
  );
