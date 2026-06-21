-- =====================================================================
-- 0018_self_referral_constraint.sql
--
-- BUG-REFERRAL-01: Add a CHECK constraint on users.referred_by to
--   prevent a user from being recorded as their own referrer.
--   The application layer already guards against this, but a DB-level
--   constraint ensures data integrity even if that guard is bypassed.
--
-- Idempotent: uses DROP CONSTRAINT IF EXISTS before adding.
-- =====================================================================

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_no_self_referral;

ALTER TABLE users
  ADD CONSTRAINT users_no_self_referral
  CHECK (referred_by IS NULL OR referred_by <> id);
