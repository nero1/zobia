-- Migration 010: User block list, DM privacy, and missing schema columns (PRD §3, §7, §14, §18)

-- ============================================================
-- 1. user_blocks — bilateral block list
-- ============================================================
-- When user A blocks user B:
--   - B cannot send DMs to A
--   - Any pending friendship between A and B is cancelled
--   - B's messages in A's feed are filtered client-side
CREATE TABLE IF NOT EXISTS user_blocks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(blocker_id, blocked_id),
  CHECK(blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

-- ============================================================
-- 2. DM privacy and soft-delete columns on users
-- ============================================================

-- dm_privacy: controls who can send the user DMs
ALTER TABLE users ADD COLUMN IF NOT EXISTS dm_privacy TEXT NOT NULL DEFAULT 'everyone'
  CHECK(dm_privacy IN ('everyone', 'friends_only', 'nobody'));

-- deleted_at: soft-delete timestamp — rows with non-NULL deleted_at are invisible to
-- normal queries. All user queries use WHERE deleted_at IS NULL.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- ============================================================
-- 3. Creator payout columns on users
-- ============================================================
-- These columns are read by /api/creator/payouts and /api/creator/kyc.

-- Gross earnings available for payout (in kobo). Incremented by webhook on gift/subscription
-- received; decremented when payout is requested.
ALTER TABLE users ADD COLUMN IF NOT EXISTS available_earnings_kobo BIGINT NOT NULL DEFAULT 0;

-- Paystack or DodoPayments recipient code (set after KYC / bank-account confirmation).
ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_recipient_code TEXT;

-- Last 4 digits of the creator's bank account (display only, never full account number).
ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_account_last4 TEXT;

-- ============================================================
-- 4. gifts table — add status column and coin_cost alias
-- ============================================================
-- The gifts/send route inserts 'coin_cost' and 'status'.
-- Original schema only has 'coin_value'. Add both missing columns.

ALTER TABLE gifts ADD COLUMN IF NOT EXISTS coin_cost INTEGER;
ALTER TABLE gifts ADD COLUMN IF NOT EXISTS status    TEXT NOT NULL DEFAULT 'delivered'
  CHECK(status IN ('delivered', 'failed', 'refunded'));

-- Back-fill coin_cost from coin_value for existing rows
UPDATE gifts SET coin_cost = coin_value WHERE coin_cost IS NULL;

-- Make coin_cost NOT NULL after back-fill
ALTER TABLE gifts ALTER COLUMN coin_cost SET NOT NULL;

-- ============================================================
-- 5. creator_payouts table (required by /api/creator/payouts)
-- ============================================================
CREATE TABLE IF NOT EXISTS creator_payouts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gross_kobo          BIGINT NOT NULL,
  net_kobo            BIGINT NOT NULL,
  platform_fee_kobo   BIGINT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'awaiting_approval', 'processing', 'completed', 'failed', 'reversed')),
  provider_reference  TEXT,
  provider_status     TEXT,
  bank_account_last4  TEXT,
  idempotency_key     TEXT NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  UNIQUE(idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_creator_payouts_creator ON creator_payouts(creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_payouts_status  ON creator_payouts(status) WHERE status NOT IN ('completed', 'failed');

-- ============================================================
-- 6. DM reply limit tightening — update x_manifest defaults
-- ============================================================
-- Free: 25 replies/day, Plus: 50 replies/day (PRD §3 table)
INSERT INTO x_manifest (key, value, description) VALUES
  ('dm_reply_limit_free', '25', 'Max DM replies per day for Free plan'),
  ('dm_reply_limit_plus', '50', 'Max DM replies per day for Plus plan')
ON CONFLICT (key) DO NOTHING;
