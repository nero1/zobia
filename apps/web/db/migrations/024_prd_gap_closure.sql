-- Migration 024: PRD Gap Closure
-- Adds:
--   1. Premium Send animation store item (PRD §11)
--   2. guild_treasury_log table for Legend tier 5% room revenue share (PRD §13)
--   3. track_milestone_unlocks table (if not exists — ensures Creator L5/L20 gates work)
--   4. dm_conversations.conversation_score column (for connection badge on profiles)
--   5. users.xp_creator column alias safety
--   6. users.creator_tier inclusion in profile query

-- ─── 1. Premium Send animation store item ─────────────────────────────────────
-- Item type: booster (purchasable with coins, applies a premium animation to the next message)
INSERT INTO store_items (
  name,
  description,
  item_type,
  coins_cost,
  is_active,
  is_featured,
  sort_order,
  metadata,
  created_at,
  updated_at
)
VALUES (
  'Premium Send',
  'Apply a premium animation to your next message. Available as a one-time send or a 7-day subscription.',
  'booster',
  50,           -- 50 Coins per-message activation
  TRUE,
  FALSE,
  90,
  '{"subtype": "premium_send", "duration_type": "one_shot", "animation": "gold_shimmer"}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT DO NOTHING;

-- 7-day Premium Send subscription pack
INSERT INTO store_items (
  name,
  description,
  item_type,
  coins_cost,
  is_active,
  is_featured,
  sort_order,
  metadata,
  created_at,
  updated_at
)
VALUES (
  'Premium Send — 7 Day Pass',
  'Activate Premium Send animations on all your messages for 7 days.',
  'booster',
  250,          -- 250 Coins for 7-day pass
  TRUE,
  FALSE,
  91,
  '{"subtype": "premium_send", "duration_type": "subscription", "duration_days": 7, "animation": "gold_shimmer"}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT DO NOTHING;

-- ─── 2. guild_treasury_log — Legend tier 5% room revenue share tracking ────────
CREATE TABLE IF NOT EXISTS guild_treasury_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id     UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  amount       INTEGER NOT NULL CHECK (amount >= 0),
  source       TEXT NOT NULL,  -- 'donation' | 'war_reward' | 'quest_reward' | 'room_revenue_share'
  reference_id TEXT,           -- room_id for room_revenue_share entries
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guild_treasury_log_guild_id
  ON guild_treasury_log(guild_id, created_at DESC);

-- ─── 3. track_milestone_unlocks — ensure table exists ──────────────────────────
CREATE TABLE IF NOT EXISTS track_milestone_unlocks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track          TEXT NOT NULL,
  milestone_level INTEGER NOT NULL,
  unlock_key     TEXT NOT NULL,
  unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, track, milestone_level)
);

CREATE INDEX IF NOT EXISTS idx_track_milestone_unlocks_user_id
  ON track_milestone_unlocks(user_id, track);

-- ─── 4. dm_conversations.conversation_score ────────────────────────────────────
-- Add conversation_score column if not already present (stores cumulative daily streak days)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dm_conversations' AND column_name = 'conversation_score'
  ) THEN
    ALTER TABLE dm_conversations ADD COLUMN conversation_score INTEGER NOT NULL DEFAULT 0;
  END IF;
END$$;

-- ─── 5. users.xp_creator — ensure column exists ────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'xp_creator'
  ) THEN
    ALTER TABLE users ADD COLUMN xp_creator INTEGER NOT NULL DEFAULT 0;
  END IF;
END$$;

-- ─── 6. rooms.cover_emoji — ensure column exists ───────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rooms' AND column_name = 'cover_emoji'
  ) THEN
    ALTER TABLE rooms ADD COLUMN cover_emoji TEXT NOT NULL DEFAULT '💬';
  END IF;
END$$;

-- ─── 7. creator_earnings — ensure table exists ─────────────────────────────────
CREATE TABLE IF NOT EXISTS creator_earnings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type        TEXT NOT NULL,  -- 'gift' | 'subscription' | 'classroom' | 'merch' | 'broadcast'
  gross_amount_kobo  INTEGER NOT NULL DEFAULT 0,
  platform_fee_kobo  INTEGER NOT NULL DEFAULT 0,
  net_amount_kobo    INTEGER NOT NULL DEFAULT 0,
  reference_id       UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_earnings_creator_id
  ON creator_earnings(creator_id, created_at DESC);

-- ─── 8. users.available_earnings_kobo — ensure column exists ───────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'available_earnings_kobo'
  ) THEN
    ALTER TABLE users ADD COLUMN available_earnings_kobo INTEGER NOT NULL DEFAULT 0;
  END IF;
END$$;

-- ─── 9. guilds.treasury_balance — ensure column exists ─────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'guilds' AND column_name = 'treasury_balance'
  ) THEN
    ALTER TABLE guilds ADD COLUMN treasury_balance INTEGER NOT NULL DEFAULT 0;
  END IF;
END$$;

-- ─── 10. rooms.is_ad_enrolled — ad revenue share programme (PRD §10) ───────────
-- Free Open Rooms with 500+ monthly active members are auto-enrolled.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rooms' AND column_name = 'is_ad_enrolled'
  ) THEN
    ALTER TABLE rooms ADD COLUMN is_ad_enrolled BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END$$;

-- ─── 11. room_monthly_active_users — snapshot table for MAU tracking ───────────
CREATE TABLE IF NOT EXISTS room_monthly_active_users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  month      DATE NOT NULL,         -- first day of the month, e.g. 2024-06-01
  mau_count  INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, month)
);

CREATE INDEX IF NOT EXISTS idx_room_mau_room_id
  ON room_monthly_active_users(room_id, month DESC);
