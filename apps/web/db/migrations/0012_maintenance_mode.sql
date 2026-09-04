-- 0012_maintenance_mode.sql
--
-- Maintenance mode: admin-configurable via /gate44/config ("Maintenance Mode"
-- group, PUT /api/admin/config/[key]). When maintenance_mode_enabled is true,
-- non-staff visitors see maintenance_message instead of the app
-- (app/(app)/layout.tsx, app/auth/login/page.tsx) — admins and moderators are
-- unaffected and see a reminder bar instead (components/admin/AdminLayoutShell.tsx).

INSERT INTO x_manifest (key, value, description) VALUES
  ('maintenance_mode_enabled', 'false', 'When true, non-staff visitors see the maintenance message instead of the app'),
  ('maintenance_message', 'Zobia is briefly unavailable at the moment due to system maintenance. Kindly check back later.', 'Message shown to visitors while maintenance mode is on')
ON CONFLICT (key) DO NOTHING;
