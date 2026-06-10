-- Migration 007: Add 2FA feature flag keys to x_manifest
-- Adds auth_2fa_enabled and auth_2fa_required_for_mods keys.
-- feature_pin_auth already exists in the base schema.

INSERT INTO x_manifest (key, value, description) VALUES
  ('auth_2fa_enabled',           'true',  'Allow users to configure two-factor authentication'),
  ('auth_2fa_required_for_mods', 'false', 'Require 2FA for moderators before they can log in')
ON CONFLICT (key) DO NOTHING;
