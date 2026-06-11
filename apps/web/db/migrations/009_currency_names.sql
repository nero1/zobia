-- Migration 009: Add configurable currency display names to x_manifest
-- Admins can rename the soft currency (default: Credit/Credits)
-- and premium currency (default: Star/Stars) from the config panel.

INSERT INTO x_manifest (key, value, description) VALUES
  ('currency_soft_name_singular',    '"Credit"',  'Singular display name for the earned soft currency (e.g. Credit)'),
  ('currency_soft_name_plural',      '"Credits"', 'Plural display name for the earned soft currency (e.g. Credits)'),
  ('currency_premium_name_singular', '"Star"',    'Singular display name for the purchased premium currency (e.g. Star)'),
  ('currency_premium_name_plural',   '"Stars"',   'Plural display name for the purchased premium currency (e.g. Stars)')
ON CONFLICT (key) DO NOTHING;
