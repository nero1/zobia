-- Migration 0015: sitewide UI theme + icon set admin defaults
--
-- Adds two x_manifest rows backing the new "Theming" group at
-- /gate44/config: an admin-set default site theme (default/reddit/facebook/
-- christmas — a color/shape/density re-skin of the whole app shell, see
-- shared/utils/uiThemes.ts and apps/web/app/globals.css's
-- `[data-site-theme="..."]` blocks) and default icon set (emoji/mono).
-- Users may override either per-device in Settings > Appearance
-- (localStorage/Capacitor Preferences only — never synced to the server,
-- same policy as the existing light/dark theme preference).
--
-- No new table, so no GRANT statements needed here — x_manifest already has
-- its Data API grants from its original migration.

BEGIN;

INSERT INTO x_manifest (key, value, description) VALUES
  ('ui_site_theme', 'default', 'Default sitewide UI theme applied to every device that has not chosen its own override: default | reddit | facebook | christmas. Editable at /gate44/config ("Theming"). See shared/utils/uiThemes.ts.'),
  ('ui_icon_set', 'emoji', 'Default nav/UI icon set applied to every device that has not chosen its own override: emoji | mono (black-and-white vector icons). Editable at /gate44/config ("Theming"). See shared/utils/uiThemes.ts.')
ON CONFLICT (key) DO NOTHING;

COMMIT;
