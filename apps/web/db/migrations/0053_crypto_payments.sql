-- 0053_crypto_payments.sql
--
-- Crypto payment provider (replaces DodoPayments as the "international"
-- payment provider — see lib/payments/crypto/):
--
--   1. payments            — add chain/token/tx columns so crypto rows are
--                             queryable/exportable without stuffing into
--                             the existing jsonb metadata column.
--   2. crypto_exchange_rate_overrides — admin manual USD price override per
--                             currency, with optional auto-expiry back to
--                             the live/auto price feed.
--   3. crypto_price_cache   — last-fetched live USD price per currency, so
--                             the lazy-refresh-on-read strategy in
--                             priceFeed.ts survives serverless cold starts
--                             without an extra Redis round trip.
--   4. payment_context_settings — per payment-context (business tier,
--                             subscription, coins, stars, merch, ...)
--                             independent Paystack / crypto-currency /
--                             free toggles, seeded to match current
--                             (Paystack-only, not free) behavior.
--   5. user_crypto_wallets  — a user's own saved wallet addresses (for
--                             *sending* payments — distinct from
--                             creator_wallet_addresses, which is where a
--                             creator *receives* payouts).
-- ---------------------------------------------------------------------------

-- 1. payments — crypto-specific columns -------------------------------------

ALTER TABLE payments ADD COLUMN IF NOT EXISTS chain text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS token_symbol text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tx_hash text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS wallet_address text;
-- Amount actually expected in the token's smallest unit (wei/lamports),
-- computed server-side from the live/manual price feed at initiation time —
-- verification recomputes and compares against this, never trusting a
-- client-submitted amount.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS expected_token_amount numeric(38, 0);

CREATE INDEX IF NOT EXISTS idx_payments_tx_hash ON payments (tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_provider_status ON payments (provider, status);

-- 2. crypto_exchange_rate_overrides ------------------------------------------

CREATE TABLE IF NOT EXISTS crypto_exchange_rate_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_symbol text NOT NULL UNIQUE,
  usd_price numeric(24, 10) NOT NULL CHECK (usd_price > 0),
  set_by_admin_id uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 3. crypto_price_cache -------------------------------------------------------

CREATE TABLE IF NOT EXISTS crypto_price_cache (
  token_symbol text PRIMARY KEY,
  usd_price numeric(24, 10) NOT NULL CHECK (usd_price > 0),
  source text NOT NULL DEFAULT 'live',
  fetched_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 4. payment_context_settings --------------------------------------------------

CREATE TABLE IF NOT EXISTS payment_context_settings (
  context_key text PRIMARY KEY,
  paystack_enabled boolean NOT NULL DEFAULT true,
  -- Array of enabled crypto currency symbols for this context, e.g. ["JAGA"].
  crypto_enabled_currencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_free boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

INSERT INTO payment_context_settings (context_key, paystack_enabled, crypto_enabled_currencies, is_free) VALUES
  ('business_tier',    true, '[]'::jsonb, false),
  ('business_renew',   true, '[]'::jsonb, false),
  ('subscription',     true, '[]'::jsonb, false),
  ('coin_purchase',    true, '[]'::jsonb, false),
  ('star_purchase',    true, '[]'::jsonb, false),
  ('merch_purchase',   true, '[]'::jsonb, false)
ON CONFLICT (context_key) DO NOTHING;

-- 5. user_crypto_wallets -------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_crypto_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain text NOT NULL,
  address text NOT NULL,
  label text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, chain)
);

CREATE INDEX IF NOT EXISTS idx_user_crypto_wallets_user ON user_crypto_wallets (user_id);

-- x_manifest defaults for the new crypto config knobs ------------------------

INSERT INTO x_manifest (key, value, description) VALUES
  ('payment_crypto_price_refresh_minutes', '360', 'Minutes between live crypto price-feed refreshes (lazy, on read). 5-10080 (7 days).'),
  ('payment_usd_to_ngn_rate', '1600', 'USD→NGN rate used only to display crypto-equivalent prices in Naira; core pricing stays kobo-denominated.'),
  ('payment_crypto_discounts', '{"JAGA":20,"BNB":0,"SOL":0}', 'Per-currency checkout discount percentage when paying in crypto.')
ON CONFLICT (key) DO NOTHING;
