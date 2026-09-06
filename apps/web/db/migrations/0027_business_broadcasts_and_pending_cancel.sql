-- 0027_business_broadcasts_and_pending_cancel.sql
--
-- Two independent additions bundled together:
--
-- 1. Business Accounts can now cancel an in-progress signup/upgrade payment
--    (app/api/business/pending/route.ts DELETE) instead of waiting out the
--    30-minute pending-payment TTL. That requires a 'cancelled' status on
--    the payments table, which the existing CHECK constraint doesn't allow.
--
-- 2. Business Account broadcasts (PRD §17 — "Broadcast capability" per tier)
--    reuse the existing creator_broadcasts table/pattern rather than
--    inventing a new one, but a business owner may ALSO be a personal
--    creator with their own separate creator_tier broadcast quota. Without
--    a way to tell the two apart, sending a business broadcast would wrongly
--    consume — or be blocked by — the user's personal creator broadcast
--    quota (both are counted by a plain "WHERE creator_id = $1" query).
--    business_account_id distinguishes the two: NULL means a personal
--    creator broadcast (unchanged behaviour), set means a Business Account
--    broadcast, counted and quota-checked separately in
--    app/api/business/broadcasts/route.ts.

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'refunded'::text, 'cancelled'::text]));

ALTER TABLE creator_broadcasts ADD COLUMN IF NOT EXISTS business_account_id uuid REFERENCES business_accounts(id);

CREATE INDEX IF NOT EXISTS idx_creator_broadcasts_business_account_created
  ON creator_broadcasts (business_account_id, created_at)
  WHERE business_account_id IS NOT NULL;
