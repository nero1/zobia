-- 0042_announcement_gender_targeting.sql
--
-- Adds gender-based audience targeting to platform announcements, mirroring
-- the existing target_plans / target_roles columns (empty array = "show to
-- everyone" for that dimension). Values are the same enum used by
-- users.gender: male | female | non_binary | prefer_not_to_say.

ALTER TABLE announcement_modals
  ADD COLUMN IF NOT EXISTS target_genders text[] DEFAULT ARRAY[]::text[];

ALTER TABLE announcement_banners
  ADD COLUMN IF NOT EXISTS target_genders text[] DEFAULT ARRAY[]::text[];
