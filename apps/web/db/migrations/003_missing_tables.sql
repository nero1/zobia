-- ============================================================
-- Migration 003: Missing tables referenced in application code
-- ============================================================

-- Fix xp_ledger to add missing columns used by engine code
-- (existing columns: amount, track, source, reference_id, multiplier, base_amount)
-- Engine code uses: action, xp_amount, xp_net, metadata
ALTER TABLE xp_ledger
  ADD COLUMN IF NOT EXISTS action TEXT,
  ADD COLUMN IF NOT EXISTS xp_amount INTEGER,
  ADD COLUMN IF NOT EXISTS xp_net INTEGER,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Backfill for existing rows
UPDATE xp_ledger SET
  action = source,
  xp_amount = amount,
  xp_net = amount
WHERE action IS NULL;

-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_xp_ledger_action ON xp_ledger(action);

-- ============================================================
-- user_quest_progress (questEngine.ts uses this, schema has user_quests)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_quest_progress (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id),
  quest_id        UUID NOT NULL REFERENCES quest_templates(id),
  quest_date      DATE NOT NULL,
  progress_count  INTEGER NOT NULL DEFAULT 0,
  completed       BOOLEAN NOT NULL DEFAULT false,
  completed_at    TIMESTAMPTZ,
  expired_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, quest_id, quest_date)
);
CREATE INDEX IF NOT EXISTS idx_user_quest_progress_user_date ON user_quest_progress(user_id, quest_date);

-- ============================================================
-- classroom_enrolments
-- ============================================================
CREATE TABLE IF NOT EXISTS classroom_enrolments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id     UUID NOT NULL REFERENCES rooms(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  paid        BOOLEAN NOT NULL DEFAULT false,
  fee_kobo    BIGINT NOT NULL DEFAULT 0,
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  certificate_issued BOOLEAN DEFAULT false,
  certificate_issued_at TIMESTAMPTZ,
  UNIQUE(room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_classroom_enrolments_room ON classroom_enrolments(room_id);
CREATE INDEX IF NOT EXISTS idx_classroom_enrolments_user ON classroom_enrolments(user_id);

-- ============================================================
-- classroom_quizzes — assessment quizzes inside ClassRooms
-- ============================================================
CREATE TABLE IF NOT EXISTS classroom_quizzes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id     UUID NOT NULL REFERENCES rooms(id),
  creator_id  UUID NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  description TEXT,
  xp_reward   INTEGER NOT NULL DEFAULT 50,
  pass_score  INTEGER NOT NULL DEFAULT 70, -- percentage
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classroom_quiz_questions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quiz_id      UUID NOT NULL REFERENCES classroom_quizzes(id),
  question     TEXT NOT NULL,
  option_a     TEXT NOT NULL,
  option_b     TEXT NOT NULL,
  option_c     TEXT NOT NULL,
  option_d     TEXT NOT NULL,
  correct_option TEXT NOT NULL CHECK (correct_option IN ('a','b','c','d')),
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classroom_quiz_attempts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quiz_id      UUID NOT NULL REFERENCES classroom_quizzes(id),
  user_id      UUID NOT NULL REFERENCES users(id),
  score        INTEGER NOT NULL, -- percentage 0-100
  passed       BOOLEAN NOT NULL,
  answers      JSONB NOT NULL, -- {question_id: selected_option}
  xp_awarded   INTEGER DEFAULT 0,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(quiz_id, user_id)
);

-- ============================================================
-- creator_broadcasts
-- ============================================================
CREATE TABLE IF NOT EXISTS creator_broadcasts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id      UUID NOT NULL REFERENCES users(id),
  subject         TEXT,
  content         TEXT NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  cost_coins      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_creator_broadcasts_creator ON creator_broadcasts(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_broadcasts_created ON creator_broadcasts(created_at DESC);

-- ============================================================
-- telegram_delivery_queue — async Telegram cross-delivery
-- ============================================================
CREATE TABLE IF NOT EXISTS telegram_delivery_queue (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  broadcast_id UUID NOT NULL REFERENCES creator_broadcasts(id),
  telegram_ids JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- ============================================================
-- elder_requests / elder_mentorships
-- ============================================================
CREATE TABLE IF NOT EXISTS elder_requests (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mentee_id  UUID NOT NULL REFERENCES users(id),
  elder_id   UUID NOT NULL REFERENCES users(id),
  message    TEXT,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mentee_id, elder_id)
);

CREATE TABLE IF NOT EXISTS elder_mentorships (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  elder_id   UUID NOT NULL REFERENCES users(id),
  mentee_id  UUID NOT NULL REFERENCES users(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at   TIMESTAMPTZ,
  UNIQUE(elder_id, mentee_id)
);
CREATE INDEX IF NOT EXISTS idx_elder_mentorships_elder ON elder_mentorships(elder_id);
CREATE INDEX IF NOT EXISTS idx_elder_mentorships_mentee ON elder_mentorships(mentee_id);

-- ============================================================
-- war_contributions — per-member war point records
-- ============================================================
CREATE TABLE IF NOT EXISTS war_contributions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  war_id     UUID NOT NULL REFERENCES guild_wars(id),
  user_id    UUID NOT NULL REFERENCES users(id),
  guild_id   UUID NOT NULL REFERENCES guilds(id),
  war_points INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(war_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_war_contributions_war ON war_contributions(war_id);
CREATE INDEX IF NOT EXISTS idx_war_contributions_user ON war_contributions(user_id);

-- ============================================================
-- season_rank_archives — final season rankings per user
-- ============================================================
CREATE TABLE IF NOT EXISTS season_rank_archives (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id      UUID NOT NULL REFERENCES seasons(id),
  user_id        UUID NOT NULL REFERENCES users(id),
  final_rank     INTEGER,
  final_season_xp INTEGER NOT NULL DEFAULT 0,
  archived_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_season_rank_archives_season ON season_rank_archives(season_id);
CREATE INDEX IF NOT EXISTS idx_season_rank_archives_user ON season_rank_archives(user_id);

-- ============================================================
-- user_badges — earned achievement and seasonal badges
-- ============================================================
CREATE TABLE IF NOT EXISTS user_badges (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id),
  badge_type  TEXT NOT NULL,
  reference_id TEXT,
  awarded_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, badge_type, reference_id)
);
CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);

-- ============================================================
-- moderation_actions — log of all moderation actions taken
-- ============================================================
CREATE TABLE IF NOT EXISTS moderation_actions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  target_user_id  UUID NOT NULL REFERENCES users(id),
  moderator_id    UUID REFERENCES users(id),
  action_type     TEXT NOT NULL CHECK (action_type IN (
    'warn','suspend','ban','remove_content','escalate','dismiss'
  )),
  reason          TEXT,
  report_id       UUID REFERENCES reports(id),
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_target ON moderation_actions(target_user_id);

-- ============================================================
-- user_season_passes (fix: schema has season_passes, code uses user_season_passes)
-- Create view alias for backward compatibility
-- ============================================================
CREATE OR REPLACE VIEW user_season_passes AS
  SELECT id, user_id, season_id, tier, purchased_at,
         0 AS season_xp, NULL::INT AS season_rank
  FROM season_passes;

-- Add season_xp and season_rank columns to season_passes
ALTER TABLE season_passes
  ADD COLUMN IF NOT EXISTS season_xp   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS season_rank INTEGER;

-- Drop view and recreate pointing to actual table
DROP VIEW IF EXISTS user_season_passes;

-- ============================================================
-- sponsored_quests — creator quest marketplace
-- ============================================================
CREATE TABLE IF NOT EXISTS sponsored_quests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_name      TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  target_action   TEXT NOT NULL,
  target_value    INTEGER NOT NULL,
  reward_coins    INTEGER NOT NULL,
  creator_payout_kobo BIGINT NOT NULL,
  platform_fee_kobo   BIGINT NOT NULL,
  min_creator_tier TEXT NOT NULL DEFAULT 'verified',
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT true,
  max_creators    INTEGER DEFAULT 10,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sponsored_quest_applications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quest_id        UUID NOT NULL REFERENCES sponsored_quests(id),
  creator_id      UUID NOT NULL REFERENCES users(id),
  room_id         UUID REFERENCES rooms(id),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','completed','paid')),
  progress        INTEGER NOT NULL DEFAULT 0,
  completed_at    TIMESTAMPTZ,
  payout_id       UUID,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(quest_id, creator_id)
);

-- ============================================================
-- sticker_packs — sticker catalogue system
-- ============================================================
CREATE TABLE IF NOT EXISTS sticker_packs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  description TEXT,
  cover_emoji TEXT NOT NULL DEFAULT '🎨',
  pack_type   TEXT NOT NULL DEFAULT 'free'
                CHECK (pack_type IN ('free','earnable','premium')),
  coin_price  INTEGER NOT NULL DEFAULT 0,
  unlock_condition TEXT, -- for earnable packs
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stickers (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pack_id    UUID NOT NULL REFERENCES sticker_packs(id),
  name       TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  image_url  TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sticker_packs (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id),
  pack_id    UUID NOT NULL REFERENCES sticker_packs(id),
  acquired_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, pack_id)
);

-- Default free sticker packs
INSERT INTO sticker_packs (name, description, cover_emoji, pack_type, coin_price) VALUES
  ('Naija Vibes', 'Nigerian cultural expressions', '🇳🇬', 'free', 0),
  ('Flex Pack', 'Show off your style', '💎', 'earnable', 0),
  ('Boss Moves', 'Premium reactions', '👑', 'premium', 150)
ON CONFLICT DO NOTHING;

-- ============================================================
-- platform_vitality_events — admin-managed cultural calendar
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  description     TEXT,
  event_type      TEXT NOT NULL DEFAULT 'cultural'
                    CHECK (event_type IN ('cultural','season_launch','flash_xp','guild_war_event','mystery_drop','platform')),
  xp_multiplier   DECIMAL(3,1) DEFAULT 1.0,
  coin_bonus_pct  INTEGER DEFAULT 0,
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN DEFAULT true,
  target_cities   TEXT[],
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- flash_xp_events — double XP hours
-- ============================================================
CREATE TABLE IF NOT EXISTS flash_xp_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  multiplier   DECIMAL(3,1) NOT NULL DEFAULT 2.0,
  announced_at TIMESTAMPTZ NOT NULL,
  fires_at     TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  is_active    BOOLEAN DEFAULT true,
  fired        BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- guild_alliances — Platinum+ guild alliance system
-- ============================================================
CREATE TABLE IF NOT EXISTS guild_alliances (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  founded_by  UUID NOT NULL REFERENCES guilds(id),
  is_active   BOOLEAN DEFAULT true,
  wars_won    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_alliance_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alliance_id UUID NOT NULL REFERENCES guild_alliances(id),
  guild_id    UUID NOT NULL REFERENCES guilds(id),
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(alliance_id, guild_id)
);

-- ============================================================
-- business_accounts
-- ============================================================
CREATE TABLE IF NOT EXISTS business_accounts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) UNIQUE,
  business_name   TEXT NOT NULL,
  business_type   TEXT,
  tier            TEXT NOT NULL DEFAULT 'starter'
                    CHECK (tier IN ('starter','growth','enterprise')),
  verified        BOOLEAN DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','suspended','cancelled')),
  subscription_id UUID REFERENCES subscriptions(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- community_notes — crowdsourced context notes on flagged content
-- ============================================================
CREATE TABLE IF NOT EXISTS community_notes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  target_type TEXT NOT NULL CHECK (target_type IN ('message','room','user','guild')),
  target_id   UUID NOT NULL,
  author_id   UUID NOT NULL REFERENCES users(id),
  content     TEXT NOT NULL,
  helpful_votes   INTEGER NOT NULL DEFAULT 0,
  unhelpful_votes INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'needs_review'
                CHECK (status IN ('needs_review','shown','hidden')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_community_notes_target ON community_notes(target_type, target_id);

CREATE TABLE IF NOT EXISTS community_note_votes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  note_id     UUID NOT NULL REFERENCES community_notes(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  helpful     BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(note_id, user_id)
);

-- ============================================================
-- platform_council — top 50 by legacy score advisory body
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_council_members (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) UNIQUE,
  cycle_month     TEXT NOT NULL, -- YYYY-MM
  legacy_score    INTEGER NOT NULL,
  joined_at       TIMESTAMPTZ DEFAULT NOW(),
  left_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS platform_council_ideas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id   UUID NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  votes       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','selected','implemented','rejected')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- creator_merch_store — Elite+ digital/physical merch
-- ============================================================
CREATE TABLE IF NOT EXISTS merch_stores (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID NOT NULL REFERENCES users(id) UNIQUE,
  name       TEXT NOT NULL,
  description TEXT,
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS merch_products (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id    UUID NOT NULL REFERENCES merch_stores(id),
  name        TEXT NOT NULL,
  description TEXT,
  product_type TEXT NOT NULL DEFAULT 'digital'
                CHECK (product_type IN ('digital','physical','course_material')),
  price_kobo  BIGINT NOT NULL,
  image_url   TEXT,
  is_active   BOOLEAN DEFAULT true,
  stock       INTEGER, -- null = unlimited
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS merch_orders (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id  UUID NOT NULL REFERENCES merch_products(id),
  buyer_id    UUID NOT NULL REFERENCES users(id),
  creator_id  UUID NOT NULL REFERENCES users(id),
  amount_kobo BIGINT NOT NULL,
  creator_share_kobo BIGINT NOT NULL,
  platform_fee_kobo  BIGINT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','completed','refunded')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- drop_room_replays — text highlight replays for Drop Rooms
-- ============================================================
CREATE TABLE IF NOT EXISTS drop_room_replays (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id      UUID NOT NULL REFERENCES rooms(id) UNIQUE,
  creator_id   UUID NOT NULL REFERENCES users(id),
  title        TEXT NOT NULL,
  highlights   JSONB NOT NULL, -- array of {message_id, content, sender, timestamp}
  replay_fee_kobo BIGINT NOT NULL DEFAULT 0,
  is_published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- guild_contribution_alerts — tracks when members are below average
-- ============================================================
CREATE TABLE IF NOT EXISTS guild_contribution_alerts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id    UUID NOT NULL REFERENCES guilds(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  weeks_below INTEGER NOT NULL DEFAULT 1,
  alerted_at  TIMESTAMPTZ DEFAULT NOW(),
  resolved    BOOLEAN DEFAULT false,
  UNIQUE(guild_id, user_id)
);

-- ============================================================
-- user_dm_unlock — tracks the 2-reply unlock per conversation
-- ============================================================
CREATE TABLE IF NOT EXISTS dm_conversation_unlocks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_key TEXT NOT NULL UNIQUE, -- sorted user IDs joined
  initiator_id    UUID NOT NULL REFERENCES users(id),
  recipient_id    UUID NOT NULL REFERENCES users(id),
  reply_count     INTEGER NOT NULL DEFAULT 0,
  unlocked        BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- creator_kyc — KYC verification for creator payouts
-- ============================================================
CREATE TABLE IF NOT EXISTS creator_kyc (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id      UUID NOT NULL REFERENCES users(id) UNIQUE,
  full_name       TEXT,
  bvn_last4       TEXT,
  bank_account_number TEXT,
  bank_code       TEXT,
  bank_name       TEXT,
  kyc_status      TEXT NOT NULL DEFAULT 'unverified'
                    CHECK (kyc_status IN ('unverified','pending','verified','rejected')),
  verified_at     TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Seed: default sticker items for Naija Vibes pack
-- ============================================================
INSERT INTO stickers (pack_id, name, emoji, position)
SELECT sp.id, 'Naija Pride', '🇳🇬', 1 FROM sticker_packs sp WHERE sp.name = 'Naija Vibes'
ON CONFLICT DO NOTHING;

INSERT INTO stickers (pack_id, name, emoji, position)
SELECT sp.id, 'Oya Now', '😤', 2 FROM sticker_packs sp WHERE sp.name = 'Naija Vibes'
ON CONFLICT DO NOTHING;

INSERT INTO stickers (pack_id, name, emoji, position)
SELECT sp.id, 'No Cap', '🙅', 3 FROM sticker_packs sp WHERE sp.name = 'Naija Vibes'
ON CONFLICT DO NOTHING;

INSERT INTO stickers (pack_id, name, emoji, position)
SELECT sp.id, 'Sapa Mode', '😭', 4 FROM sticker_packs sp WHERE sp.name = 'Naija Vibes'
ON CONFLICT DO NOTHING;

INSERT INTO stickers (pack_id, name, emoji, position)
SELECT sp.id, 'God Don Butter My Bread', '🙏', 5 FROM sticker_packs sp WHERE sp.name = 'Naija Vibes'
ON CONFLICT DO NOTHING;

-- ============================================================
-- Seed: cultural vitality calendar events
-- ============================================================
INSERT INTO platform_events (name, description, event_type, xp_multiplier, starts_at, ends_at, metadata)
VALUES
  ('Nigerian Independence Day Double XP', 'Full-platform double XP on Oct 1st', 'cultural', 2.0,
   '2025-10-01 00:00:00+00', '2025-10-01 23:59:59+00', '{"city_filter": null}'),
  ('Detty December Season', 'The biggest season of the year — maximum guild wars and gifting', 'cultural', 1.5,
   '2025-12-01 00:00:00+00', '2025-12-31 23:59:59+00', '{"city_filter": null}'),
  ('Valentine Gift Weekend', 'Double XP for gifts sent', 'cultural', 1.0,
   '2026-02-14 00:00:00+00', '2026-02-16 23:59:59+00', '{"gift_xp_multiplier": 2}')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Add last_war_ended_at to guilds if missing
-- ============================================================
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS last_war_ended_at TIMESTAMPTZ;

-- Fix nemesis_assignments to match engine code
ALTER TABLE nemesis_assignments
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;
-- The engine uses nemesis_id as the column name but schema has nemesis_user_id
-- Add an alias column
ALTER TABLE nemesis_assignments
  ADD COLUMN IF NOT EXISTS nemesis_id UUID REFERENCES users(id);
-- Backfill
UPDATE nemesis_assignments SET nemesis_id = nemesis_user_id WHERE nemesis_id IS NULL;
