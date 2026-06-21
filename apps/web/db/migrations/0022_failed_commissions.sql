-- TASK-04: Add failed_commissions table for referral commission DLQ
-- Mirrors the pattern from failed_xp_awards to ensure commissions are
-- never silently dropped on network errors after a payment commits.

CREATE TABLE IF NOT EXISTS failed_commissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  TEXT NOT NULL,
  user_id     UUID NOT NULL,
  coin_amount INTEGER NOT NULL,
  amount_kobo INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'unknown',
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_retried_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_failed_commissions_payment_id
  ON failed_commissions (payment_id)
  WHERE payment_id IS NOT NULL;
