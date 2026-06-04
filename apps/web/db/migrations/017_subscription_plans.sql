-- migration: 017_subscription_plans
-- Creates the subscription_plans catalogue table and seeds monthly + annual plans.
-- Annual plans use 10-month pricing (2 months free) per PRD §3.
--
-- Default prices (NGN, stored in kobo):
--   Plus:  ₦500/month  → ₦5,000/year
--   Pro:   ₦1,500/month → ₦15,000/year
--   Max:   ₦3,500/month → ₦35,000/year

CREATE TABLE IF NOT EXISTS subscription_plans (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan          TEXT        NOT NULL,  -- 'plus' | 'pro' | 'max'
  name          TEXT        NOT NULL,
  interval      TEXT        NOT NULL DEFAULT 'monthly'
                              CHECK (interval IN ('monthly', 'annual')),
  price_kobo    BIGINT      NOT NULL,
  currency      TEXT        NOT NULL DEFAULT 'NGN',
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order    INT         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT subscription_plans_plan_interval_uq UNIQUE (plan, interval)
);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_active
  ON subscription_plans (is_active, plan, interval);

-- Seed monthly plans
INSERT INTO subscription_plans (plan, name, interval, price_kobo, currency, is_active, sort_order)
VALUES
  ('plus',  'Plus — Monthly',  'monthly',    50000, 'NGN', TRUE, 10),
  ('pro',   'Pro — Monthly',   'monthly',   150000, 'NGN', TRUE, 20),
  ('max',   'Max — Monthly',   'monthly',   350000, 'NGN', TRUE, 30)
ON CONFLICT (plan, interval) DO NOTHING;

-- Seed annual plans (10×monthly price = 2 months free)
INSERT INTO subscription_plans (plan, name, interval, price_kobo, currency, is_active, sort_order)
VALUES
  ('plus',  'Plus — Annual',   'annual',    500000, 'NGN', TRUE, 11),
  ('pro',   'Pro — Annual',    'annual',   1500000, 'NGN', TRUE, 21),
  ('max',   'Max — Annual',    'annual',   3500000, 'NGN', TRUE, 31)
ON CONFLICT (plan, interval) DO NOTHING;

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION update_subscription_plans_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscription_plans_updated_at ON subscription_plans;
CREATE TRIGGER subscription_plans_updated_at
  BEFORE UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION update_subscription_plans_updated_at();
