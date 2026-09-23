-- 0006_currency_crypto_classroom_billing.sql
--
-- Currency display fix (NGN vs USD by region), crypto payouts ledger,
-- classroom draft/publish workflow, and subscription cancellation feedback.

-- ---------------------------------------------------------------------------
-- Currency / region
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS country_source text NOT NULL DEFAULT 'default';
ALTER TABLE users ADD COLUMN IF NOT EXISTS currency_preference text;

-- ---------------------------------------------------------------------------
-- Classroom draft/publish workflow
-- ---------------------------------------------------------------------------

-- NULL = never published (created as a draft, PRD-required default going
-- forward). Existing classrooms are backfilled to "published now" so nothing
-- already live silently disappears from the directory.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS published_at timestamptz;
UPDATE rooms SET published_at = created_at WHERE type = 'classroom' AND published_at IS NULL;

INSERT INTO x_manifest (key, value, description, updated_at) VALUES ('classroom_max_total_free', '3', 'Max classrooms (draft + live) a Free plan user may own.', NOW()) ON CONFLICT DO NOTHING;
INSERT INTO x_manifest (key, value, description, updated_at) VALUES ('classroom_max_total_plus', '10', 'Max classrooms (draft + live) a Plus plan user may own.', NOW()) ON CONFLICT DO NOTHING;
INSERT INTO x_manifest (key, value, description, updated_at) VALUES ('classroom_max_total_pro', '15', 'Max classrooms (draft + live) a Pro plan user may own.', NOW()) ON CONFLICT DO NOTHING;
INSERT INTO x_manifest (key, value, description, updated_at) VALUES ('classroom_max_total_max', '20', 'Max classrooms (draft + live) a Max plan user may own.', NOW()) ON CONFLICT DO NOTHING;
INSERT INTO x_manifest (key, value, description, updated_at) VALUES ('classroom_free_min_level', '5', 'Creator-track level a Free plan user must reach before creating any classroom.', NOW()) ON CONFLICT DO NOTHING;
INSERT INTO x_manifest (key, value, description, updated_at) VALUES ('classroom_chat_max_active', '20', 'Target max concurrently-active participants in a classroom chat Room.', NOW()) ON CONFLICT DO NOTHING;
INSERT INTO x_manifest (key, value, description, updated_at) VALUES ('classroom_chat_max_total', '150', 'Max total roster of a classroom once its chat Room is enabled.', NOW()) ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Crypto payouts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS crypto_balance_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency text NOT NULL,
  amount_base_units numeric(40, 0) NOT NULL,
  source_type text NOT NULL,
  reference_id text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_crypto_balance_ledger_currency_reference ON crypto_balance_ledger (currency, reference_id);
CREATE INDEX IF NOT EXISTS idx_crypto_balance_ledger_user ON crypto_balance_ledger (user_id, created_at);

CREATE TABLE IF NOT EXISTS creator_crypto_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency text NOT NULL,
  balance_base_units numeric(40, 0) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_creator_crypto_balances_user_currency ON creator_crypto_balances (user_id, currency);

ALTER TABLE creator_payouts ADD COLUMN IF NOT EXISTS crypto_currency text;
ALTER TABLE creator_payouts ADD COLUMN IF NOT EXISTS crypto_chain text;
ALTER TABLE creator_payouts ADD COLUMN IF NOT EXISTS crypto_amount_base_units numeric(40, 0);
ALTER TABLE creator_payouts ADD COLUMN IF NOT EXISTS crypto_tx_hash text;

-- creator_wallet_addresses: was one wallet per creator, total; now one per
-- (creator, network) so BSC (JAGA/BNB) and Solana (SOL) receiving addresses
-- can coexist with the legacy Tron/USDT manual-payout address.
ALTER TABLE creator_wallet_addresses DROP CONSTRAINT IF EXISTS creator_wallet_addresses_creator_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_creator_wallet_addresses_creator_network ON creator_wallet_addresses (creator_id, network);

INSERT INTO x_manifest (key, value, description, updated_at) VALUES ('crypto_payouts_enabled', 'false', 'Whether creators/referrers can hold and withdraw crypto-native balances (JAGA/BNB/SOL) instead of always converting earnings to Credits.', NOW()) ON CONFLICT DO NOTHING;
INSERT INTO x_manifest (key, value, description, updated_at) VALUES ('crypto_payout_mode', 'credits', 'When crypto payouts are enabled: "crypto" pays out in the earned currency, "credits" always converts to Credits.', NOW()) ON CONFLICT DO NOTHING;
