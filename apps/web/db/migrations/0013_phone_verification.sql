-- Migration 0013: phone number capture + optional OTP verification
--
-- Closes the gap left by migration 0012 (users.phone_number existed but had
-- no capture UI): adds a "Phone Number" field to Settings (self-attested by
-- default — no SMS involved, matching the platform's no-SMS policy) plus an
-- admin-toggleable SMS OTP verification step (x_manifest
-- `phone_verification_required`, seeded OFF below). See lib/phone/verification.ts
-- and app/api/users/phone/{start,verify}/route.ts.
--
-- users.phone_verified_at: set only when a number has actually been confirmed
-- via the OTP flow. Always null while verification is off (self-attested
-- capture) or before a pending code is confirmed.
--
-- phone_verification_codes: one pending OTP per user (user_id is the PK — a
-- new send overwrites any still-pending code). Brand-new table, so per the
-- project's Supabase Data-API rule it gets explicit GRANTs below.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS phone_verification_codes (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  code_hash   text NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.phone_verification_codes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.phone_verification_codes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.phone_verification_codes TO service_role;

-- Seeded OFF: default behaviour is unverified self-attested capture, per the
-- platform's "No SMS anything" policy (ZobiaSocial-PRD.md §22) — this is a
-- deliberate, admin-controlled, opt-in exception scoped to phone-number
-- capture only, not a general reversal of that policy. Editable at
-- /gate44/config ("Phone Verification" group).
INSERT INTO x_manifest (key, value, description) VALUES
  ('phone_verification_required', 'false', 'When true, users must confirm a phone number via SMS OTP before it is saved (uses the same Termii integration as admin/mod SMS alerting). When false (default), a typed phone number is saved as-is, unverified. Editable at /gate44/config.')
ON CONFLICT (key) DO NOTHING;

COMMIT;
