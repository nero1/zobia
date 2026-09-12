-- 0037_profile_avatar_upload.sql
--
-- Profile Pictures feature (custom avatar upload with crop/resize):
--   1. `users.avatar_changed_at` — dedicated timestamp separate from
--      `updated_at` (which is touched by many unrelated fields) so the
--      once-a-week change cooldown enforced in lib/profile/avatarService.ts
--      can be checked cheaply and unambiguously. NULL means "never changed"
--      (no cooldown yet). Applies to custom uploads AND switching to a
--      different default onboarding icon.
--   2. `avatar_change_cost_credits` / `avatar_change_cost_stars` x_manifest
--      keys — admin-editable at /gate44/config ("Profile Pictures" group).
--      Cost charged to a free-plan user to upload a custom photo (paid-plan
--      users upload for free; switching to a default icon is always free
--      for everyone). Defaults: 200 Credits or 1 Star, user's choice.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_changed_at timestamptz;

-- Without these rows the costs exist only as code defaults (see
-- DEFAULT_MANIFEST.avatarChange in lib/manifest/index.ts) and never appear
-- as editable fields at /gate44/config (which only lists rows that already
-- exist in this table). ON CONFLICT DO NOTHING so re-running this migration,
-- or an admin who already changed the value, is a no-op.
INSERT INTO x_manifest (key, value, description) VALUES
  ('avatar_change_cost_credits', '200', 'Credits charged to a free-plan user to upload a custom profile photo (0 = disable paying with Credits). Paid-plan users upload for free.'),
  ('avatar_change_cost_stars', '1', 'Stars charged to a free-plan user to upload a custom profile photo (0 = disable paying with Stars).')
ON CONFLICT (key) DO NOTHING;
