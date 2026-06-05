-- migration: 020_cosmetics_store
-- Adds the cosmetics catalogue and user inventory required by PRD §11
-- (Zobia Stars / Coin Store section):
--
--   "Stars are spent on: exclusive cosmetics, profile frames, and animated
--    items not available for Coins. Unlocking rare titles.
--    Purchasing limited-edition seasonal items when Coins are insufficient."
--
-- Tables:
--   cosmetic_items   — the admin-configurable catalogue of cosmetic items
--   user_cosmetics   — per-user inventory of owned / active cosmetics
--
-- store_items.item_type is extended to allow 'cosmetic' rows so the same
-- store endpoint surfaces all purchasable items in one response.

-- ---------------------------------------------------------------------------
-- 1. Extend store_items item_type constraint to include 'cosmetic'
-- ---------------------------------------------------------------------------

ALTER TABLE store_items
  DROP CONSTRAINT IF EXISTS store_items_item_type_check;

ALTER TABLE store_items
  ADD CONSTRAINT store_items_item_type_check
    CHECK (item_type IN ('coin_pack', 'star_pack', 'booster', 'cosmetic'));

-- Extra columns needed for cosmetic store items
ALTER TABLE store_items
  ADD COLUMN IF NOT EXISTS stars_cost        INTEGER,     -- cost in Stars (cosmetic items)
  ADD COLUMN IF NOT EXISTS cosmetic_type     TEXT,        -- 'profile_frame' | 'title' | 'avatar_border' | 'sticker_pack' | 'message_theme' | 'animated_item'
  ADD COLUMN IF NOT EXISTS is_exclusive      BOOLEAN NOT NULL DEFAULT FALSE,  -- cannot be bought with Coins
  ADD COLUMN IF NOT EXISTS season_id         UUID REFERENCES seasons(id) ON DELETE SET NULL,  -- limited to a Season
  ADD COLUMN IF NOT EXISTS prestige_required INTEGER;     -- minimum prestige count required to purchase

-- ---------------------------------------------------------------------------
-- 2. user_cosmetics — per-user cosmetic inventory
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_cosmetics (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_item_id  UUID        NOT NULL REFERENCES store_items(id) ON DELETE CASCADE,
  cosmetic_type  TEXT        NOT NULL,
  is_active      BOOLEAN     NOT NULL DEFAULT FALSE,  -- only one item per type can be active
  acquired_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ,                         -- NULL = permanent
  metadata       JSONB,

  UNIQUE (user_id, store_item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_cosmetics_user ON user_cosmetics (user_id, cosmetic_type);
CREATE INDEX IF NOT EXISTS idx_user_cosmetics_active ON user_cosmetics (user_id, is_active)
  WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- 3. Seed default cosmetic catalogue items
--    Profiles frames, titles, animated borders — all purchasable with Stars.
-- ---------------------------------------------------------------------------

INSERT INTO store_items
  (name, description, item_type, cosmetic_type, stars_cost, is_exclusive, is_featured, sort_order)
VALUES
  -- Profile Frames (Stars-only, exclusive)
  ('Prestige Flame Frame',     'An animated flame frame reserved for Prestige users.',      'cosmetic', 'profile_frame',  5,  TRUE,  TRUE,  10),
  ('Golden Galaxy Frame',      'Rare animated gold particles orbiting the avatar.',          'cosmetic', 'profile_frame',  10, TRUE,  FALSE, 11),
  ('Phoenix Wings Border',     'Animated phoenix wings — exclusively for Prestige holders.', 'cosmetic', 'profile_frame',  15, TRUE,  FALSE, 12),

  -- Animated Avatar Borders (Stars-only)
  ('Diamond Glow Border',      'Pulsing diamond border animation.',                          'cosmetic', 'avatar_border',  3,  FALSE, TRUE,  20),
  ('Neon Lagos Border',        'Neon-lit Lagos skyline avatar border.',                      'cosmetic', 'avatar_border',  5,  FALSE, FALSE, 21),

  -- Exclusive Titles (Stars-only)
  ('First in the City',        'Display "First in the City" beneath your username.',         'cosmetic', 'title',          8,  TRUE,  FALSE, 30),
  ('War Machine',              'Earned by winning 10 Guild Wars — exclusive title.',         'cosmetic', 'title',          12, TRUE,  FALSE, 31),
  ('The Patron',               'Top Gifter in 3+ Rooms — exclusive patron title.',           'cosmetic', 'title',          10, TRUE,  FALSE, 32),

  -- Limited-edition Animated Items (Stars or Coins)
  ('Zobia Confetti Burst',     'Animated confetti that plays when you send a message.',      'cosmetic', 'animated_item',  2,  FALSE, TRUE,  40),
  ('Gold Coin Rain',           'Gold coin shower on profile card when visited.',             'cosmetic', 'animated_item',  7,  FALSE, FALSE, 41)

ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Add active_profile_frame and active_title to users for quick reads
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_cosmetic_frame_id UUID REFERENCES store_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS active_cosmetic_title     TEXT;
