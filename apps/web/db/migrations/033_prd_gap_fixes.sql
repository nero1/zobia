-- Migration 033: PRD Gap Fixes
-- Adds schema support for: guild tier enforcement, limited room type,
-- Hall of Fame, guild member contribution tracking, merch shipping addresses,
-- flash XP timing fields, mystery XP drop scheduling, and council invitations.

-- ---------------------------------------------------------------------------
-- 1. Guild tier minimum-member grace period counter
-- ---------------------------------------------------------------------------
ALTER TABLE guilds
  ADD COLUMN IF NOT EXISTS below_minimum_days INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2. Limited Room type
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'limited'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'room_type')
  ) THEN
    ALTER TYPE room_type ADD VALUE 'limited';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Hall of Fame (Prestige 10)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hall_of_fame (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prestige_count INTEGER     NOT NULL,
  legacy_score   BIGINT      NOT NULL DEFAULT 0,
  inducted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_hall_of_fame_legacy_score ON hall_of_fame (legacy_score DESC);

-- ---------------------------------------------------------------------------
-- 4. Guild member contribution below-average tracking
-- ---------------------------------------------------------------------------
ALTER TABLE guild_members
  ADD COLUMN IF NOT EXISTS contribution_below_average_weeks INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 5. Merch order shipping address
-- ---------------------------------------------------------------------------
ALTER TABLE merch_orders
  ADD COLUMN IF NOT EXISTS shipping_name    TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address TEXT,
  ADD COLUMN IF NOT EXISTS shipping_city    TEXT,
  ADD COLUMN IF NOT EXISTS shipping_country TEXT;

-- ---------------------------------------------------------------------------
-- 6. Flash XP events: announced_at and fires_at for advance-notice vs fire-time
-- ---------------------------------------------------------------------------
ALTER TABLE flash_xp_events
  ADD COLUMN IF NOT EXISTS announced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fires_at     TIMESTAMPTZ;

-- Back-fill existing rows: treat starts_at as both announced and fires moment
UPDATE flash_xp_events
SET
  announced_at = COALESCE(announced_at, starts_at),
  fires_at     = COALESCE(fires_at,     starts_at)
WHERE announced_at IS NULL OR fires_at IS NULL;

-- ---------------------------------------------------------------------------
-- 7. Mystery XP Drop scheduling state in x_manifest (use cron_state table)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cron_state (
  key        TEXT        PRIMARY KEY,
  value_text TEXT,
  value_ts   TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the initial mystery drop schedule if not present (fires in 3 days by default)
INSERT INTO cron_state (key, value_ts, updated_at)
VALUES ('next_mystery_drop_at', NOW() + INTERVAL '3 days', NOW())
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. Council invitations table (for monthly top-50 automation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS council_invitations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at  TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  legacy_score BIGINT      NOT NULL DEFAULT 0,
  UNIQUE (user_id, invited_at::DATE)  -- one invite per user per day
);

CREATE INDEX IF NOT EXISTS idx_council_invitations_user ON council_invitations (user_id);
CREATE INDEX IF NOT EXISTS idx_council_invitations_date ON council_invitations (invited_at DESC);

-- ---------------------------------------------------------------------------
-- 9. Prestige 10 custom crest flag on users
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS custom_crest_emoji TEXT;

-- ---------------------------------------------------------------------------
-- 10. Referral lifetime commission flag (complements 031_referral_config)
-- ---------------------------------------------------------------------------
-- The x_manifest already stores referral config. Ensure the commission ledger
-- table exists for lifetime 5% cash commissions on coin purchases.
CREATE TABLE IF NOT EXISTS referral_commissions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger_event_id  TEXT        NOT NULL,           -- payment webhook event id
  purchase_amount_kobo BIGINT   NOT NULL,
  commission_kobo   BIGINT      NOT NULL,
  commission_coins  INTEGER     NOT NULL DEFAULT 0,
  status            TEXT        NOT NULL DEFAULT 'pending',  -- pending | credited | failed
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  credited_at       TIMESTAMPTZ,
  UNIQUE (trigger_event_id)  -- idempotency: one commission per webhook event
);

CREATE INDEX IF NOT EXISTS idx_referral_commissions_referrer ON referral_commissions (referrer_id);
