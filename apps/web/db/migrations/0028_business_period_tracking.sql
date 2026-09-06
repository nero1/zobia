-- 0028_business_period_tracking.sql
--
-- Business Accounts had no working expiry tracking: business_accounts.
-- subscription_id was meant to point at a `subscriptions` row (see
-- lib/plans/subscriptionSweep.ts comments), but `subscriptions.user_id` is
-- UNIQUE — a business owner who also holds a personal Plus/Pro/Max plan
-- would collide on that same row. Nothing ever actually populated
-- subscription_id, so app/api/users/me/route.ts's business_plan_ends_at
-- subquery always returned NULL and the "business plan nearing expiry"
-- reminder (PRD §17) could never fire; the grace-period sweep in
-- subscriptionSweep.ts was equally a no-op for the same reason, AND would
-- have thrown a CHECK-constraint violation the first time it tried to set
-- status = 'grace' (not a previously allowed value).
--
-- Fix: track the business billing period directly on business_accounts,
-- independent of the personal subscriptions table. Paystack one-off
-- checkout doesn't auto-renew, so current_period_ends_at is set on signup/
-- upgrade/renewal webhook success (see paystackWebhookHandler.ts /
-- dodoWebhookHandler.ts) and extended by app/api/business/renew/route.ts.

ALTER TABLE business_accounts ADD COLUMN IF NOT EXISTS current_period_ends_at timestamp with time zone;

-- 'grace' (billing period lapsed, within grace window) and 'lapsed' (grace
-- window also elapsed with no renewal) are distinct from 'suspended', which
-- remains the admin moderation action — conflating the two would make the
-- existing "suspended — contact support" notice misleading for an account
-- that simply needs to renew.
ALTER TABLE business_accounts DROP CONSTRAINT IF EXISTS business_accounts_status_check;
ALTER TABLE business_accounts ADD CONSTRAINT business_accounts_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'grace'::text, 'lapsed'::text, 'suspended'::text, 'cancelled'::text]));
