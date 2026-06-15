-- ============================================================
-- Migration 013: Business Accounts — Verification Status
-- ============================================================
-- Adds a proper verification_status workflow column to
-- business_accounts so verification can move through:
--   unverified → pending → verified | rejected
-- The legacy boolean `verified` column is preserved for
-- backwards compatibility (set to true when status=verified).
-- ============================================================

ALTER TABLE business_accounts
  ADD COLUMN IF NOT EXISTS verification_status TEXT
    NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','pending','verified','rejected')),
  ADD COLUMN IF NOT EXISTS verification_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_reviewed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_reject_reason TEXT;

-- Back-fill: accounts already marked verified=true get status=verified
UPDATE business_accounts
SET verification_status = 'verified'
WHERE verified = TRUE AND verification_status = 'unverified';

-- Index for admin queue queries (pending verifications)
CREATE INDEX IF NOT EXISTS idx_business_accounts_verification_status
  ON business_accounts (verification_status)
  WHERE verification_status IN ('pending','rejected');
