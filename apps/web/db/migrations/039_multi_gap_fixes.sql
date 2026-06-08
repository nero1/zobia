-- =============================================================================
-- 039_multi_gap_fixes.sql
--
-- Closes several verified PRD gaps:
--   GAP 4  — Sticker pack tier: locale packs seed data, fix column aliases
--   GAP 6  — Bandwidth saver: add hd_send_enabled to users
--   GAP 10 — Animated cosmetics: add active_frame_id to users
--   GAP 11 — Moderation pipeline: add pipeline_status + ai_classified_at to reports
--   GAP 12 — AI moderation config: seed x_manifest threshold keys
-- =============================================================================

-- ---------------------------------------------------------------------------
-- GAP 4 — Sticker packs: add column aliases so API route queries work
-- ---------------------------------------------------------------------------

-- Add cover_sticker_url as an alias column (populated from cover_emoji)
ALTER TABLE sticker_packs
  ADD COLUMN IF NOT EXISTS cover_sticker_url TEXT;

UPDATE sticker_packs
  SET cover_sticker_url = cover_emoji
  WHERE cover_sticker_url IS NULL;

-- Add unlocked_at to user_sticker_packs (API inserts with this name)
ALTER TABLE user_sticker_packs
  ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMPTZ;

UPDATE user_sticker_packs
  SET unlocked_at = acquired_at
  WHERE unlocked_at IS NULL;

-- Add locale column to sticker_packs for locale-themed free packs
ALTER TABLE sticker_packs
  ADD COLUMN IF NOT EXISTS locale TEXT;

-- Seed locale-themed free packs (PRD §5: locale-themed expressions)
INSERT INTO sticker_packs (name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, locale, is_active)
VALUES
  ('Naija Hausa', 'Northern Nigerian Hausa expressions', '🇳🇬', '🇳🇬', 'free', 0, 'ha', true),
  ('Yoruba Vibes', 'Yoruba cultural stickers', '🌟', '🌟', 'free', 0, 'yo', true),
  ('Igbo Pride', 'Igbo expressions and culture', '🦁', '🦁', 'free', 0, 'ig', true),
  ('Swahili Soul', 'East African Swahili stickers', '🌍', '🌍', 'free', 0, 'sw', true),
  ('Arabic Flow', 'Arabic language expressions', '✨', '✨', 'free', 0, 'ar', true),
  ('French Touch', 'Francophone African stickers', '🎭', '🎭', 'free', 0, 'fr', true),
  ('Lusophone', 'Portuguese-speaking African stickers', '🌊', '🌊', 'free', 0, 'pt', true)
ON CONFLICT DO NOTHING;

-- Seed earnable packs (tied to Social track milestones)
INSERT INTO sticker_packs (name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, unlock_condition, is_active)
VALUES
  ('Social Butterfly', 'Unlock at Social Level 5', '🦋', '🦋', 'earnable', 0, 'Reach Social Level 5', true),
  ('Connector', 'Unlock at Social Level 10', '🔗', '🔗', 'earnable', 0, 'Reach Social Level 10', true),
  ('Influencer Pack', 'Unlock at Social Level 20', '💫', '💫', 'earnable', 0, 'Reach Social Level 20', true),
  ('Legend Pack', 'Unlock at Social Level 30', '🏆', '🏆', 'earnable', 0, 'Reach Social Level 30', true),
  ('Prestige Pack', 'Unlock on first Prestige', '👑', '👑', 'earnable', 0, 'Achieve Prestige I', true)
ON CONFLICT DO NOTHING;

-- Seed premium packs (coin-purchased)
INSERT INTO sticker_packs (name, description, cover_emoji, cover_sticker_url, pack_type, coin_price, is_active)
VALUES
  ('Elite Reactions', 'Premium high-energy reactions', '⚡', '⚡', 'premium', 100, true),
  ('Luxury Flex', 'Show your premium status', '💎', '💎', 'premium', 250, true),
  ('Zobia Exclusive', 'Ultra-rare exclusive stickers', '🌌', '🌌', 'premium', 500, true)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- GAP 6 — Bandwidth saver: hd_send_enabled flag on users
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS hd_send_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- GAP 10 — Animated cosmetics: active_frame_id on users
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_frame_id TEXT;

-- ---------------------------------------------------------------------------
-- GAP 11 — Three-layer moderation pipeline columns
-- ---------------------------------------------------------------------------

ALTER TABLE moderation_reports
  ADD COLUMN IF NOT EXISTS pipeline_status TEXT NOT NULL DEFAULT 'manual_queue'
    CHECK (pipeline_status IN ('ai_auto_actioned', 'community_review', 'manual_queue', 'resolved'));

ALTER TABLE moderation_reports
  ADD COLUMN IF NOT EXISTS ai_classified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_moderation_reports_pipeline
  ON moderation_reports (pipeline_status, created_at DESC);

-- ---------------------------------------------------------------------------
-- GAP 12 — AI moderation config: seed threshold keys in x_manifest
-- ---------------------------------------------------------------------------

INSERT INTO x_manifest (key, value, description, updated_at)
VALUES
  ('ai_moderation_auto_action_threshold', '0.9',
   'Confidence threshold above which AI auto-actions a report (removes content/suspends user)', NOW()),
  ('ai_moderation_community_threshold', '0.7',
   'Confidence threshold above which a report goes to community review (below = manual queue)', NOW()),
  ('ai_moderation_system_prompt', '',
   'Override AI moderation system prompt. Leave empty to use the built-in default.', NOW())
ON CONFLICT (key) DO NOTHING;
