-- Migration 0010: sitewide new-signup toggle
--
-- Seeds the `signups_enabled` x_manifest key (see lib/manifest/index.ts
-- ZobiaManifest.signupsEnabled), admin-editable at /gate44/config and at
-- /gate44/users' Settings tab (both write this same key). Blocks NEW
-- account creation in the Google/Telegram OAuth callbacks while existing
-- users can still log in — see app/api/auth/google/callback and
-- app/api/auth/telegram/callback.

BEGIN;

INSERT INTO x_manifest (key, value, description) VALUES
  ('signups_enabled', 'true', 'Master toggle for new account signups. When false, new Google/Telegram OAuth sign-ins are refused (existing users can still log in). Editable at /gate44/config and /gate44/users (Settings tab).')
ON CONFLICT (key) DO NOTHING;

COMMIT;
