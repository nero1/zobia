-- Migration 008: Profile privacy columns and admin-controlled privacy feature flags

-- Add privacy columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_private         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS profile_hidden_sections JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS disable_friend_requests BOOLEAN NOT NULL DEFAULT FALSE;

-- Add privacy feature flag manifest keys (admin-controlled)
-- Each key is a JSON-encoded list of plans/roles that can use the feature.
-- Defaults: pro/max/prestige can lock profile; plus+ can hide sections and disable friend requests.
INSERT INTO x_manifest (key, value, description) VALUES
  ('privacy_can_lock_profile',
   '["pro","max","prestige_1"]',
   'Plans/roles allowed to lock their profile (hide from non-friends). JSON array.'),
  ('privacy_can_hide_sections',
   '["plus","pro","max","prestige_1"]',
   'Plans/roles allowed to hide individual profile sections. JSON array.'),
  ('privacy_can_disable_friend_requests',
   '["plus","pro","max","prestige_1"]',
   'Plans/roles allowed to disable incoming friend requests. JSON array.'),
  ('privacy_hideable_sections',
   '["avatar","bio","rank","xp","guild","seasons","badges"]',
   'Profile sections that users can hide (admin-controlled list). JSON array.')
ON CONFLICT (key) DO NOTHING;
