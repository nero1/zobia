-- ============================================================
-- Migration 028: Audit Fix — Schema/code reconciliation pass
-- Fixes all Tier 1 schema mismatches identified in the
-- independent PRD implementation gap report.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. rooms — rename room_type → type so every API route works
--    (All route handlers use rooms.type; schema had rooms.room_type)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rooms' AND column_name = 'room_type' AND table_schema = 'public'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rooms' AND column_name = 'type' AND table_schema = 'public'
  ) THEN
    ALTER TABLE rooms RENAME COLUMN room_type TO type;
  END IF;
END$$;

-- Drop old index (was keyed on room_type) and recreate on type
DROP INDEX IF EXISTS idx_rooms_type;
CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(type);

-- ---------------------------------------------------------------------------
-- 2. rooms — add columns required by room creation and gift routes
-- ---------------------------------------------------------------------------
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS subscription_price_ngn    BIGINT,
  ADD COLUMN IF NOT EXISTS entry_fee_ngn             BIGINT,
  ADD COLUMN IF NOT EXISTS enrolment_fee_ngn         BIGINT,
  ADD COLUMN IF NOT EXISTS class_start_date          DATE,
  ADD COLUMN IF NOT EXISTS class_end_date            DATE,
  ADD COLUMN IF NOT EXISTS spectacle_threshold_coins INTEGER,
  ADD COLUMN IF NOT EXISTS deleted_at                TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 3. room_members — add mute/kick columns used by moderation route
-- ---------------------------------------------------------------------------
ALTER TABLE room_members
  ADD COLUMN IF NOT EXISTS is_muted    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS left_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();

-- room_members.role: allow 'admin' in addition to existing values
-- The room creation route inserts role='admin' for the creator.
-- Update the constraint to include 'admin' so it doesn't violate.
ALTER TABLE room_members DROP CONSTRAINT IF EXISTS room_members_role_check;
ALTER TABLE room_members
  ADD CONSTRAINT room_members_role_check
  CHECK (role IN ('creator', 'admin', 'co_moderator', 'member'));

-- ---------------------------------------------------------------------------
-- 4. gift_items — add coin_cost (generated alias for coin_price) and
--    spectacle_threshold_coins used by gifts/send route
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Add coin_cost as a real column if it doesn't exist, backfill from coin_price
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'gift_items' AND column_name = 'coin_cost' AND table_schema = 'public'
  ) THEN
    ALTER TABLE gift_items ADD COLUMN coin_cost INTEGER;
    UPDATE gift_items SET coin_cost = coin_price WHERE coin_cost IS NULL;
    ALTER TABLE gift_items ALTER COLUMN coin_cost SET NOT NULL;
    ALTER TABLE gift_items ALTER COLUMN coin_cost SET DEFAULT 0;
  END IF;
END$$;

ALTER TABLE gift_items
  ADD COLUMN IF NOT EXISTS spectacle_threshold_coins INTEGER;

-- Update seed gift items spectacle thresholds (tier 2 = 150+ coins, tier 3 = 800+ coins)
UPDATE gift_items SET spectacle_threshold_coins = 150  WHERE tier = 2 AND spectacle_threshold_coins IS NULL;
UPDATE gift_items SET spectacle_threshold_coins = 800  WHERE tier = 3 AND spectacle_threshold_coins IS NULL;

-- ---------------------------------------------------------------------------
-- 5. gifts — ensure coin_cost and status columns exist
--    (migration 010 adds these, but guard against ordering issues)
-- ---------------------------------------------------------------------------
ALTER TABLE gifts
  ADD COLUMN IF NOT EXISTS coin_cost INTEGER,
  ADD COLUMN IF NOT EXISTS status    TEXT NOT NULL DEFAULT 'delivered';

-- Backfill coin_cost from coin_value if needed
UPDATE gifts SET coin_cost = coin_value WHERE coin_cost IS NULL AND coin_value IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. creator_earnings — migration 027 created an incompatible balance-table
--    version. The correct model (from 001) is a line-item audit log.
--    If the incompatible balance-only schema exists (user_id + balance_kobo),
--    add the missing line-item columns so all insert paths work.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- If user_id exists but creator_id doesn't, the 027 schema won is in effect.
  -- Add creator_id as alias for user_id, and the missing audit columns.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'creator_earnings' AND column_name = 'user_id' AND table_schema = 'public'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'creator_earnings' AND column_name = 'creator_id' AND table_schema = 'public'
  ) THEN
    -- Add the line-item columns the route code expects
    ALTER TABLE creator_earnings
      ADD COLUMN creator_id       UUID REFERENCES users(id),
      ADD COLUMN source_type      TEXT NOT NULL DEFAULT 'gift',
      ADD COLUMN gross_amount_kobo BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN platform_fee_kobo BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN net_amount_kobo   BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN reference_id      TEXT,
      ADD COLUMN paid_out          BOOLEAN DEFAULT false,
      ADD COLUMN payout_id         UUID,
      ADD COLUMN created_at        TIMESTAMPTZ DEFAULT NOW();

    -- Backfill creator_id from user_id
    UPDATE creator_earnings SET creator_id = user_id WHERE creator_id IS NULL;

    -- Remove the UNIQUE constraint on user_id (we now support multiple rows per creator)
    ALTER TABLE creator_earnings DROP CONSTRAINT IF EXISTS creator_earnings_user_id_key;
  END IF;
END$$;

-- If the correct 001 schema is in place, just ensure all needed columns exist
ALTER TABLE creator_earnings
  ADD COLUMN IF NOT EXISTS paid_out   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_id  UUID,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- ---------------------------------------------------------------------------
-- 7. users — ensure available_earnings_kobo exists (credited on every earning)
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS available_earnings_kobo BIGINT NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 8. x_manifest — fix key-name drift so feature flags actually work
--    Correct keys that the manifest loader reads vs what was seeded
-- ---------------------------------------------------------------------------

-- feature_nemesis → feature_nemesis_system (code reads feature_nemesis_system)
INSERT INTO x_manifest (key, value, description)
  SELECT 'feature_nemesis_system', value, 'Enable Nemesis system (canonical key)'
  FROM x_manifest WHERE key = 'feature_nemesis'
ON CONFLICT (key) DO NOTHING;

-- feature_star_direct_purchase → feature_star_purchase
INSERT INTO x_manifest (key, value, description)
  SELECT 'feature_star_purchase', value, 'Enable Star purchase (canonical key)'
  FROM x_manifest WHERE key = 'feature_star_direct_purchase'
ON CONFLICT (key) DO NOTHING;

-- feature_creator_merch → feature_merch_store
INSERT INTO x_manifest (key, value, description)
  SELECT 'feature_merch_store', value, 'Enable Merch store (canonical key)'
  FROM x_manifest WHERE key = 'feature_creator_merch'
ON CONFLICT (key) DO NOTHING;

-- Add missing feature keys that manifest loader references
INSERT INTO x_manifest (key, value, description) VALUES
  ('feature_rooms',           'true',  'Enable Rooms feature'),
  ('feature_direct_messages', 'true',  'Enable Direct Messages'),
  ('feature_gifts',           'true',  'Enable Gifts feature'),
  ('feature_rankings',        'true',  'Enable Rankings/Leaderboards'),
  ('feature_pin_auth',        'true',  'Enable PIN authentication')
ON CONFLICT (key) DO NOTHING;

-- Fix payout_large_approval_kobo key name (code reads payout_large_approval_kobo
-- but DB had payout_manual_approval_threshold_kobo)
INSERT INTO x_manifest (key, value, description)
  SELECT 'payout_large_approval_kobo', value, 'Manual approval threshold (canonical key)'
  FROM x_manifest WHERE key = 'payout_manual_approval_threshold_kobo'
ON CONFLICT (key) DO NOTHING;

-- Fix payout_threshold_kobo to PRD value of ₦1,000 = 100,000 kobo
UPDATE x_manifest SET value = '100000' WHERE key = 'payout_threshold_kobo';

-- Fix coin_to_cash_rate: manifest loader reads as integer (kobo per coin),
-- current value '0.01' is parsed as 0. Set to 1 (1 coin = 1 kobo = ₦0.01)
UPDATE x_manifest SET value = '1' WHERE key = 'coin_to_cash_rate';

-- ---------------------------------------------------------------------------
-- 9. guild_wars — ensure correct column names exist for war resolution code
-- ---------------------------------------------------------------------------
-- Migration 001 already uses challenger_guild_id / defender_guild_id.
-- Add guild_a_id / guild_b_id as functional aliases via generated columns
-- so old query code (step 1 of cron) also works.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'guild_wars' AND column_name = 'guild_a_id' AND table_schema = 'public'
  ) THEN
    ALTER TABLE guild_wars ADD COLUMN guild_a_id UUID GENERATED ALWAYS AS (challenger_guild_id) STORED;
    ALTER TABLE guild_wars ADD COLUMN guild_b_id UUID GENERATED ALWAYS AS (defender_guild_id) STORED;
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Generated columns not supported in this Postgres version; skip
  NULL;
END$$;

-- ---------------------------------------------------------------------------
-- 10. room_promotions — add promoted_by alias for creator_id
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'room_promotions' AND column_name = 'promoted_by' AND table_schema = 'public'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'room_promotions' AND table_schema = 'public'
  ) THEN
    ALTER TABLE room_promotions ADD COLUMN promoted_by UUID REFERENCES users(id);
    -- Backfill from creator_id if present
    UPDATE room_promotions SET promoted_by = creator_id WHERE promoted_by IS NULL AND creator_id IS NOT NULL;
  END IF;
END$$;

ALTER TABLE room_promotions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ---------------------------------------------------------------------------
-- 11. quest_templates — add valid_date column (quest progress route uses it)
-- ---------------------------------------------------------------------------
ALTER TABLE quest_templates
  ADD COLUMN IF NOT EXISTS valid_date DATE;

-- ---------------------------------------------------------------------------
-- 12. coin_pack pricing fix — update store_items to PRD-spec prices
--    PRD: Starter ₦200/100 coins, Legend ₦10,000/varies
-- ---------------------------------------------------------------------------
UPDATE store_items SET
  price_kobo    = 20000,
  coins_granted = 100,
  bonus_label   = NULL
WHERE name = 'Starter Pack' AND item_type = 'coin_pack';

UPDATE store_items SET
  price_kobo    = 50000,
  coins_granted = 270,
  bonus_label   = '+8% BONUS'
WHERE name = 'Regular Pack' AND item_type = 'coin_pack';

UPDATE store_items SET
  price_kobo    = 100000,
  coins_granted = 600,
  bonus_label   = '+20% BONUS'
WHERE name = 'Big Pack' AND item_type = 'coin_pack';

UPDATE store_items SET
  price_kobo    = 200000,
  coins_granted = 1500,
  bonus_label   = '+50% BONUS'
WHERE name = 'Baller Pack' AND item_type = 'coin_pack';

UPDATE store_items SET
  price_kobo    = 500000,
  coins_granted = 5000,
  bonus_label   = '+100% BONUS'
WHERE name = 'Boss Pack' AND item_type = 'coin_pack';

UPDATE store_items SET
  price_kobo    = 1000000,
  coins_granted = 12500,
  bonus_label   = '+150% BONUS'
WHERE name = 'Legend Pack' AND item_type = 'coin_pack';

-- ---------------------------------------------------------------------------
-- 13. elder_mentorships — ensure status column exists (quest route uses it)
-- ---------------------------------------------------------------------------
ALTER TABLE elder_mentorships
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'terminated'));

-- ---------------------------------------------------------------------------
-- 14. dm_conversations — ensure table exists for DM gift flow
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id_1  TEXT NOT NULL,
  user_id_2  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id_1, user_id_2)
);

-- ---------------------------------------------------------------------------
-- 15. messages — ensure conversation_id exists (DM gift flow uses it)
-- ---------------------------------------------------------------------------
ALTER TABLE room_messages
  ADD COLUMN IF NOT EXISTS conversation_id UUID;

-- Re-add messages alias view for DM context (gift send route uses INSERT INTO messages)
-- The messages table was renamed to room_messages in migration 009.
-- DM path in gift send inserts into 'messages'. Create a view or keep table.
-- Since DM inserts still reference 'messages', create a separate dm_messages table
-- (room_messages is for room chat; messages is for DMs)
CREATE TABLE IF NOT EXISTS messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id    UUID NOT NULL REFERENCES users(id),
  recipient_id UUID REFERENCES users(id),
  conversation_id UUID REFERENCES dm_conversations(id),
  message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text','sticker','gif','gift','moment','system','broadcast')),
  content      TEXT,
  media_url    TEXT,
  metadata     JSONB,
  coin_cost    BIGINT DEFAULT 0,
  reply_count_from_recipient INTEGER DEFAULT 0,
  is_deleted   BOOLEAN DEFAULT false,
  is_flagged   BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_sender_dm ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_dm ON messages(recipient_id) WHERE recipient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id) WHERE conversation_id IS NOT NULL;
