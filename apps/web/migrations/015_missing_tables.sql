-- Migration 015: missing_tables
--
-- Creates tables required by new API endpoints:
--   - room_promotions         : coin-based room promotion records
--   - automated_actions_log   : log of all automated moderation/trust-safety actions
--   - merch_orders            : merch purchase order records
--
-- Also backfills a column on an existing table:
--   - rooms.spectacle_threshold_coins : per-room spectacle coin threshold (PRD §12)
--
-- Safe to run multiple times (all statements use IF NOT EXISTS / IF EXISTS guards).

-- ---------------------------------------------------------------------------
-- Room Coin Promotions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS room_promotions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  promoted_by  UUID        NOT NULL REFERENCES users(id),
  coin_cost    INTEGER     NOT NULL DEFAULT 0,
  starts_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at      TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id)
);

CREATE INDEX IF NOT EXISTS idx_room_promotions_ends_at
  ON room_promotions(ends_at);

-- ---------------------------------------------------------------------------
-- Automated Actions Log (PRD §20)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS automated_actions_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- e.g. content_removed, user_flagged, xp_stripped, mystery_drop
  action_type     TEXT        NOT NULL,
  -- e.g. message, user, room, guild
  target_type     TEXT,
  target_id       UUID,
  target_user_id  UUID        REFERENCES users(id),
  metadata        JSONB       DEFAULT '{}',
  reversed_at     TIMESTAMPTZ,
  reversed_by     UUID        REFERENCES users(id),
  reverse_note    TEXT,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aal_action_type
  ON automated_actions_log(action_type);

CREATE INDEX IF NOT EXISTS idx_aal_created_at
  ON automated_actions_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_aal_target_user
  ON automated_actions_log(target_user_id);

-- ---------------------------------------------------------------------------
-- Merch Orders
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS merch_orders (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID        NOT NULL REFERENCES merch_stores(id),
  product_id          UUID        NOT NULL REFERENCES merch_products(id),
  buyer_id            UUID        NOT NULL REFERENCES users(id),
  price_kobo          BIGINT      NOT NULL,
  platform_fee_kobo   BIGINT      NOT NULL,
  creator_net_kobo    BIGINT      NOT NULL,
  -- pending, processing, completed, failed, refunded
  status              TEXT        NOT NULL DEFAULT 'pending',
  -- coins, paystack, dodopayments
  payment_method      TEXT        NOT NULL DEFAULT 'coins',
  provider_reference  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merch_orders_buyer
  ON merch_orders(buyer_id);

CREATE INDEX IF NOT EXISTS idx_merch_orders_store
  ON merch_orders(store_id);

-- ---------------------------------------------------------------------------
-- Creator spectacle threshold per room (PRD §12)
-- ---------------------------------------------------------------------------

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS spectacle_threshold_coins INTEGER DEFAULT NULL;
