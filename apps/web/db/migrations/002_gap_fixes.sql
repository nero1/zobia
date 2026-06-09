-- =============================================================================
-- Migration 002: Gap fixes — guild quest Monday constraint, announcement
-- rotation tracking, pidgin setting, physical goods fulfillment
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Guild quest week_start must be a Monday (UTC ISO day-of-week = 1)
-- ---------------------------------------------------------------------------
ALTER TABLE guild_quests
  ADD CONSTRAINT guild_quests_week_start_is_monday
    CHECK (EXTRACT(ISODOW FROM week_start AT TIME ZONE 'UTC') = 1);

-- ---------------------------------------------------------------------------
-- 2. Server-side announcement rotation tracking
--    Tracks which modal/banner was last shown to each user so serial rotation
--    works correctly across devices and reinstalls.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_announcement_rotation (
  user_id        UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type   TEXT    NOT NULL CHECK (content_type IN ('modal', 'banner')),
  last_shown_id  UUID    NOT NULL,
  last_shown_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, content_type)
);

CREATE INDEX IF NOT EXISTS idx_user_ann_rotation_user
  ON user_announcement_rotation (user_id);

-- ---------------------------------------------------------------------------
-- 3. Per-user Pidgin suggestions opt-in/opt-out
--    NULL  = use system default (locale-based)
--    TRUE  = user explicitly enabled
--    FALSE = user explicitly disabled
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pidgin_suggestions_enabled BOOLEAN DEFAULT NULL;

-- ---------------------------------------------------------------------------
-- 4. Physical goods fulfillment — extend merch schema
-- ---------------------------------------------------------------------------

-- 4a. Add per-creator physical goods toggle and default fulfillment method to stores
ALTER TABLE merch_stores
  ADD COLUMN IF NOT EXISTS physical_goods_enabled    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_fulfillment_method TEXT
    DEFAULT 'manual' CHECK (default_fulfillment_method IN ('manual', 'partner'));

-- 4b. Extend merch_orders with fulfillment tracking columns
--     First drop the old status constraint so we can replace it
ALTER TABLE merch_orders
  DROP CONSTRAINT IF EXISTS merch_orders_status_check;

ALTER TABLE merch_orders
  ADD CONSTRAINT merch_orders_status_check
    CHECK (status IN ('pending', 'shipped', 'in_transit', 'delivered', 'completed', 'refunded')),
  ADD COLUMN IF NOT EXISTS fulfillment_method TEXT    DEFAULT 'manual'
    CHECK (fulfillment_method IN ('manual', 'partner')),
  ADD COLUMN IF NOT EXISTS seller_notes       TEXT,
  ADD COLUMN IF NOT EXISTS shipped_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at       TIMESTAMPTZ,
  -- Array of { status, note, timestamp } JSON objects
  ADD COLUMN IF NOT EXISTS tracking_updates   JSONB   DEFAULT '[]'::jsonb;

-- Index for efficient seller order queries
CREATE INDEX IF NOT EXISTS idx_merch_orders_creator_status
  ON merch_orders (creator_id, status);

-- Index for efficient buyer order queries
CREATE INDEX IF NOT EXISTS idx_merch_orders_buyer_status
  ON merch_orders (buyer_id, status);
