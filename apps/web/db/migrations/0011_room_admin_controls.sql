-- Migration: 0011_room_admin_controls.sql
-- Adds admin/moderator control columns to rooms table:
-- suspension, banning, flagging, monetization toggle, and admin notes.

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS is_suspended        BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suspended_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_by        UUID        REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspension_reason   TEXT,
  ADD COLUMN IF NOT EXISTS is_banned           BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS banned_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_by           UUID        REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS flagged_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS flagged_by          UUID        REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS flag_reason         TEXT,
  ADD COLUMN IF NOT EXISTS monetization_disabled BOOLEAN   NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS admin_notes         TEXT;

CREATE INDEX IF NOT EXISTS idx_rooms_flagged    ON rooms(flagged_at)   WHERE flagged_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rooms_suspended  ON rooms(is_suspended) WHERE is_suspended = TRUE;
CREATE INDEX IF NOT EXISTS idx_rooms_banned     ON rooms(is_banned)    WHERE is_banned = TRUE;
