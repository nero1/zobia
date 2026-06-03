-- ============================================================
-- Zobia Social — Migration 005: Custom Reaction Sets
-- ============================================================
-- Purchasable Zobia-specific reaction sets (100–500 Coins per pack).
-- Reacting with a custom reaction awards 1 XP to the sender.
-- Separate from sticker packs: these are emoji-only reaction palettes.
-- ============================================================

-- ============================================================
-- reaction_sets — catalogue of purchasable reaction packs
-- ============================================================
CREATE TABLE IF NOT EXISTS reaction_sets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  coin_price    INT  NOT NULL DEFAULT 100,
  preview_emoji TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- reaction_set_items — individual reactions within a set
-- ============================================================
CREATE TABLE IF NOT EXISTS reaction_set_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id     UUID NOT NULL REFERENCES reaction_sets(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  name       TEXT NOT NULL,
  sort_order INT  NOT NULL DEFAULT 0
);

-- ============================================================
-- user_reaction_sets — records which users own which sets
-- ============================================================
CREATE TABLE IF NOT EXISTS user_reaction_sets (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id       UUID NOT NULL REFERENCES reaction_sets(id) ON DELETE CASCADE,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, set_id)
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_reaction_set_items_set_id    ON reaction_set_items(set_id);
CREATE INDEX IF NOT EXISTS idx_user_reaction_sets_user_id   ON user_reaction_sets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_reaction_sets_set_id    ON user_reaction_sets(set_id);
