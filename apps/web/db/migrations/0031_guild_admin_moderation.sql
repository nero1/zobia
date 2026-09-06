-- 0031_guild_admin_moderation.sql
--
-- Adds admin moderation columns to `guilds` so the new /gate44/guilds admin
-- panel can suspend/ban/annotate guilds the same way /gate44/rooms already
-- does for rooms (see idx_rooms_suspended / idx_rooms_banned / admin_notes
-- in 0001_consolidated_schema.sql). `guilds` previously only had
-- `is_active` (a plain on/off toggle used for soft "disable") and
-- `deleted_at` (hard soft-delete) — neither tracks *why* or *by whom* a
-- guild was suspended, and there was no ban state at all.

ALTER TABLE guilds
    ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS suspended_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS suspended_by uuid,
    ADD COLUMN IF NOT EXISTS suspension_reason text,
    ADD COLUMN IF NOT EXISTS is_banned boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS banned_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS banned_by uuid,
    ADD COLUMN IF NOT EXISTS admin_notes text;

ALTER TABLE guilds DROP CONSTRAINT IF EXISTS guilds_suspended_by_fkey;
ALTER TABLE guilds
    ADD CONSTRAINT guilds_suspended_by_fkey FOREIGN KEY (suspended_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE guilds DROP CONSTRAINT IF EXISTS guilds_banned_by_fkey;
ALTER TABLE guilds
    ADD CONSTRAINT guilds_banned_by_fkey FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guilds_suspended ON guilds USING btree (is_suspended) WHERE (is_suspended = true);
CREATE INDEX IF NOT EXISTS idx_guilds_banned ON guilds USING btree (is_banned) WHERE (is_banned = true);

-- Guild-specific audit_log / admin_actions entries used by the new admin
-- routes (see lib/audit/auditLog.ts AuditAction union, extended alongside
-- this migration to include the literals below).
COMMENT ON COLUMN guilds.admin_notes IS 'Internal admin-only notes, not shown to guild members.';
