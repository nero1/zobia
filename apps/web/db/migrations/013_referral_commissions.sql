-- Migration 013: Referral commission tracking table
-- Appended to enable Tier 1/2 commission tracking for coin purchases.

CREATE TABLE IF NOT EXISTS referral_commissions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referee_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier                   SMALLINT NOT NULL CHECK (tier IN (1, 2)),
  coin_amount            INTEGER NOT NULL CHECK (coin_amount > 0),
  purchase_coin_amount   INTEGER NOT NULL CHECK (purchase_coin_amount > 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_commissions_referrer_id
  ON referral_commissions (referrer_id);

CREATE INDEX IF NOT EXISTS idx_referral_commissions_referee_id
  ON referral_commissions (referee_id);

-- users.referred_by: foreign key to the user who referred this user
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_referred_by
  ON users (referred_by) WHERE referred_by IS NOT NULL;

-- RLS
ALTER TABLE referral_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY referral_commissions_owner ON referral_commissions
  USING (referrer_id = current_setting('app.user_id', true)::uuid);
