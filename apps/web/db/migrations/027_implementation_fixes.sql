-- Migration 027: Implementation fixes and missing schema items
-- Adds tables and columns required by code fixes in this iteration.

-- ---------------------------------------------------------------------------
-- 1. user_email_preferences — per-user, per-type email opt-out
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_email_preferences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  is_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_user_email_prefs_user
  ON user_email_preferences(user_id);

-- ---------------------------------------------------------------------------
-- 2. referrals — add qualified tracking columns if not already present
-- ---------------------------------------------------------------------------

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS qualified    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_referrals_qualified
  ON referrals(referrer_id) WHERE qualified = FALSE;

-- ---------------------------------------------------------------------------
-- 3. star_ledger — stars economy ledger (prestige P2+ rewards, season top)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS star_ledger (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount           INT NOT NULL,
  transaction_type TEXT NOT NULL,
  description      TEXT,
  reference_id     UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_star_ledger_user
  ON star_ledger(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. users — add star_balance column if not present
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS star_balance INT NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 5. users — creator_tier column for creator progression
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS creator_tier TEXT NOT NULL DEFAULT 'rookie'
    CHECK (creator_tier IN ('rookie', 'rising', 'verified', 'elite', 'icon'));

-- ---------------------------------------------------------------------------
-- 6. nemesis_assignments — add created_at if not present (needed for notifications)
-- ---------------------------------------------------------------------------

ALTER TABLE nemesis_assignments
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ---------------------------------------------------------------------------
-- 7. user_subscriptions — add table if missing for subscription lifecycle
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                   TEXT NOT NULL DEFAULT 'paystack',
  provider_subscription_id   TEXT,
  status                     TEXT NOT NULL DEFAULT 'active',
  next_renewal_at            TIMESTAMPTZ,
  cancelled_at               TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

-- ---------------------------------------------------------------------------
-- 8. creator_earnings — add table if missing for automated payouts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS creator_earnings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  balance_kobo BIGINT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 9. admin_roles — lightweight role table for moderation digest
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admin_roles (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, role)
);

-- ---------------------------------------------------------------------------
-- 10. moderation_ai_escalations — store layer-3 AI analysis results
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS moderation_ai_escalations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id  UUID NOT NULL,
  admin_id   UUID NOT NULL REFERENCES users(id),
  provider   TEXT NOT NULL,
  verdict    TEXT NOT NULL CHECK (verdict IN ('violation', 'borderline', 'no_violation')),
  confidence NUMERIC(4,3) NOT NULL,
  reasoning  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_ai_escalations_report
  ON moderation_ai_escalations(report_id);

-- ---------------------------------------------------------------------------
-- 11. alliance_wars — weekly National Alliance War tracking
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alliance_wars (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alliance_1_id      UUID NOT NULL,
  alliance_2_id      UUID NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  winner_alliance_id UUID,
  alliance_1_xp      BIGINT NOT NULL DEFAULT 0,
  alliance_2_xp      BIGINT NOT NULL DEFAULT 0,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alliance_wars_active
  ON alliance_wars(status) WHERE status = 'active';
