-- 0013_audit_log_viewer.sql
--
-- Supports the new /gate44/audit-logs admin page (GET /api/admin/audit-logs),
-- which reads admin_audit_log (config/KYC/payout/etc. admin actions) and
-- audit_log (security events: login, 2FA, PIN, admin ban/suspend) with
-- keyset (created_at, id) pagination instead of OFFSET, so listing stays
-- fast no matter how many rows have accumulated.
--
-- created_at-only indexes back the unfiltered "all recent entries" query;
-- the existing idx_audit_log_actor / _action / _target and
-- idx_admin_audit_log_admin indexes already cover the filtered cases.

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log USING btree (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at
  ON admin_audit_log USING btree (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action
  ON admin_audit_log USING btree (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target
  ON admin_audit_log USING btree (target_type, target_id, created_at DESC);
