-- ============================================================
-- Migration 014: Add business_upgrade to payments.payment_type
-- ============================================================
-- The payments table CHECK constraint must include 'business_upgrade'
-- so that tier upgrade payment records can be stored before the
-- webhook fires and activates the new tier.
-- ============================================================

-- Drop and recreate the payment_type CHECK to include business_upgrade.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_type_check;
ALTER TABLE payments ADD CONSTRAINT payments_payment_type_check
  CHECK (payment_type IN (
    'coin_purchase',
    'subscription',
    'season_pass',
    'booster_pack',
    'room_entry',
    'room_subscription',
    'business_upgrade'
  ));
