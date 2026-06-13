-- ============================================================
-- Zobia Social — Complete Schema (consolidated from migrations 001–011)
-- Run on a fresh database. Safe to re-run: uses IF NOT EXISTS.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- SECTION 1: Configuration tables
-- ============================================================

CREATE TABLE IF NOT EXISTS x_manifest (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cron_state (
  key        TEXT PRIMARY KEY,
  value_text TEXT,
  value_ts   TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SECTION 2: Users & Auth
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username     TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  email        TEXT UNIQUE,
  password_hash TEXT,
  pin_hash     TEXT,
  avatar_emoji TEXT NOT NULL DEFAULT '😊',
  bio          TEXT,
  city         TEXT,
  country      TEXT DEFAULT 'NG',
  locale       TEXT DEFAULT 'en',
  gender       TEXT CHECK (gender IN ('female','male','non_binary','prefer_not_to_say')),

  -- Auth
  google_id         TEXT UNIQUE,
  telegram_id       TEXT UNIQUE,
  is_email_verified BOOLEAN DEFAULT false,
  two_fa_secret     TEXT,
  two_fa_enabled    BOOLEAN DEFAULT false,
  totp_secret       TEXT,
  totp_enabled      BOOLEAN NOT NULL DEFAULT false,

  -- Status
  plan          TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','plus','pro','max')),
  is_admin      BOOLEAN NOT NULL DEFAULT false,
  is_moderator  BOOLEAN NOT NULL DEFAULT false,
  is_creator    BOOLEAN NOT NULL DEFAULT false,
  creator_tier  TEXT NOT NULL DEFAULT 'rookie'
                  CHECK (creator_tier IN ('rookie','rising','verified','elite','icon')),
  creator_role  BOOLEAN NOT NULL DEFAULT false,
  is_verified   BOOLEAN DEFAULT false,
  is_seed       BOOLEAN NOT NULL DEFAULT false,
  is_council_member BOOLEAN NOT NULL DEFAULT false,

  -- Trust & Safety
  trust_score       INTEGER DEFAULT 50 CHECK (trust_score BETWEEN 0 AND 100),
  is_suspended      BOOLEAN DEFAULT false,
  suspended_until   TIMESTAMPTZ,
  suspension_reason TEXT,
  is_banned         BOOLEAN DEFAULT false,
  ban_type          TEXT CHECK (ban_type IN ('temporary','permanent')),
  banned_until      TIMESTAMPTZ,
  ban_reason        TEXT,
  dm_privacy        TEXT NOT NULL DEFAULT 'everyone'
                      CHECK (dm_privacy IN ('everyone','friends_only','nobody')),
  dm_opt_out        BOOLEAN NOT NULL DEFAULT false,
  deleted_at        TIMESTAMPTZ,

  -- XP & Rank
  xp_total       INTEGER NOT NULL DEFAULT 0,
  legacy_score   INTEGER NOT NULL DEFAULT 0,
  rank_name      TEXT    NOT NULL DEFAULT 'Beginner',
  rank_level     INTEGER NOT NULL DEFAULT 1,
  rank_sublevel  INTEGER NOT NULL DEFAULT 1,
  prestige_count INTEGER NOT NULL DEFAULT 0,
  prestige_cycle_boost_expires_at TIMESTAMPTZ,
  custom_crest   TEXT CHECK (char_length(custom_crest) <= 500),

  -- Track XP
  xp_social      INTEGER NOT NULL DEFAULT 0,
  xp_creator     INTEGER NOT NULL DEFAULT 0,
  xp_competitor  INTEGER NOT NULL DEFAULT 0,
  xp_generosity  INTEGER NOT NULL DEFAULT 0,
  xp_knowledge   INTEGER NOT NULL DEFAULT 0,
  xp_explorer    INTEGER NOT NULL DEFAULT 0,

  -- Track Levels
  level_social     INTEGER NOT NULL DEFAULT 1,
  level_creator    INTEGER NOT NULL DEFAULT 1,
  level_competitor INTEGER NOT NULL DEFAULT 1,
  level_generosity INTEGER NOT NULL DEFAULT 1,
  level_knowledge  INTEGER NOT NULL DEFAULT 1,
  level_explorer   INTEGER NOT NULL DEFAULT 1,

  -- Economy
  coin_balance            BIGINT  NOT NULL DEFAULT 0,
  star_balance            INTEGER NOT NULL DEFAULT 0,
  available_earnings_kobo BIGINT  NOT NULL DEFAULT 0,
  payout_recipient_code   TEXT,
  payout_account_last4    TEXT,

  -- Streaks
  login_streak             INTEGER NOT NULL DEFAULT 0,
  login_streak_days        INTEGER NOT NULL DEFAULT 0,
  longest_streak           INTEGER NOT NULL DEFAULT 0,
  last_streak_before_break INTEGER NOT NULL DEFAULT 0,
  last_login_at            TIMESTAMPTZ,
  last_login_date          DATE,
  last_active_at           TIMESTAMPTZ DEFAULT NOW(),

  -- Guild (FK added after guilds table)
  guild_id UUID,

  -- Onboarding & personalisation
  date_of_birth              DATE,
  vibe_quiz_responses        JSONB,
  onboarding_personalization JSONB,
  onboarding_completed       BOOLEAN DEFAULT false,
  new_member_quest_completed BOOLEAN DEFAULT false,
  chat_theme                 TEXT NOT NULL DEFAULT 'default',

  -- Referral
  referred_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  referral_code TEXT UNIQUE,

  -- Cosmetics (FKs added after store_items table)
  active_cosmetic_frame_id UUID,
  active_cosmetic_title    TEXT,
  active_frame_id          TEXT,
  hd_send_enabled          BOOLEAN NOT NULL DEFAULT false,

  -- Push & notification preferences
  push_token            TEXT,
  dm_notifications      BOOLEAN DEFAULT true,
  guild_notifications   BOOLEAN DEFAULT true,
  streak_notifications  BOOLEAN DEFAULT true,
  notify_new_message    BOOLEAN NOT NULL DEFAULT true,
  notify_friend_request BOOLEAN NOT NULL DEFAULT true,
  notify_gift_received  BOOLEAN NOT NULL DEFAULT true,
  notify_rank_up        BOOLEAN NOT NULL DEFAULT true,
  notify_war_start      BOOLEAN NOT NULL DEFAULT true,
  notify_season_end     BOOLEAN NOT NULL DEFAULT true,
  notify_announcement   BOOLEAN NOT NULL DEFAULT true,
  email_all_enabled     BOOLEAN NOT NULL DEFAULT true,
  email_non_critical    BOOLEAN NOT NULL DEFAULT true,

  -- Admin nudges
  nudge_email_shown_at     TIMESTAMPTZ,
  nudge_email_dismissed_at TIMESTAMPTZ,

  -- Misc personalisation & privacy
  pidgin_suggestions_enabled BOOLEAN DEFAULT NULL,
  avatar_url                 TEXT,
  profile_private            BOOLEAN NOT NULL DEFAULT FALSE,
  profile_hidden_sections    JSONB   NOT NULL DEFAULT '[]',
  disable_friend_requests    BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL,
  device_info        JSONB,
  ip_address         INET,
  is_admin_session   BOOLEAN DEFAULT false,
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  last_used_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_pins (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  pin_hash   TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_push_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  platform   TEXT NOT NULL DEFAULT 'android',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

CREATE TABLE IF NOT EXISTS user_blocks (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(blocker_id, blocked_id),
  CHECK(blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS user_email_preferences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  is_enabled        BOOLEAN NOT NULL DEFAULT true,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, notification_type)
);

CREATE TABLE IF NOT EXISTS data_export_requests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  download_url TEXT,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS telegram_login_states (
  state        VARCHAR(64) PRIMARY KEY,
  status       VARCHAR(16) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','expired')),
  token        TEXT,
  user_payload TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- SECTION 3: Social Graph & Messaging
-- ============================================================

CREATE TABLE IF NOT EXISTS friendships (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','accepted','blocked')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(requester_id, addressee_id)
);

CREATE TABLE IF NOT EXISTS follows (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_id, following_id)
);

CREATE TABLE IF NOT EXISTS dm_conversations (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id_1          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_2          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_score INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id_1, user_id_2),
  CHECK(user_id_1 < user_id_2)
);

-- DM messages (separate from room_messages)
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES dm_conversations(id) ON DELETE SET NULL,
  message_type    TEXT NOT NULL DEFAULT 'text'
                    CHECK (message_type IN ('text','sticker','gif','gift','moment','system','broadcast')),
  content         TEXT,
  media_url       TEXT,
  metadata        JSONB,
  coin_cost       BIGINT DEFAULT 0,
  reply_count_from_recipient INTEGER DEFAULT 0,
  is_read         BOOLEAN NOT NULL DEFAULT false,
  is_deleted      BOOLEAN DEFAULT false,
  is_flagged      BOOLEAN DEFAULT false,
  sender_plan_at_creation TEXT DEFAULT 'free',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dm_conversation_unlocks (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_key TEXT NOT NULL UNIQUE,
  initiator_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reply_count      INTEGER NOT NULL DEFAULT 0,
  unlocked         BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_scores (
  user_id_1            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_2            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score                INTEGER NOT NULL DEFAULT 0,
  streak_days          INTEGER NOT NULL DEFAULT 0,
  last_message_date    DATE,
  has_connection_badge BOOLEAN NOT NULL DEFAULT false,
  badge_unlocked_at    TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id_1, user_id_2),
  CONSTRAINT cs_ordered_pair CHECK (user_id_1 < user_id_2)
);

CREATE TABLE IF NOT EXISTS dm_conversation_score_milestones (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id_a       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_b       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  milestone_score INTEGER NOT NULL,
  awarded_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id_a, user_id_b, milestone_score)
);

CREATE TABLE IF NOT EXISTS dm_score_sticker_unlocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id_1   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_2   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_name   TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id_1, user_id_2, pack_name)
);

CREATE TABLE IF NOT EXISTS group_chats (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  creator_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  avatar_emoji TEXT DEFAULT '👥',
  tag          TEXT CHECK (tag IN ('Study Group','Crew','Business')),
  member_count INTEGER NOT NULL DEFAULT 1,
  max_members  INTEGER NOT NULL DEFAULT 300,
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_chat_members (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_chat_id UUID NOT NULL REFERENCES group_chats(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  joined_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  payload    JSONB,
  title      TEXT,
  body       TEXT,
  metadata   JSONB,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content      TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'direct'
                 CHECK (message_type IN ('direct','broadcast','admin','system')),
  reference_id UUID,
  is_read      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_inactivity_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inactive_days INTEGER NOT NULL,
  notified      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, inactive_days, created_at)
);

CREATE TABLE IF NOT EXISTS moments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  content_type  TEXT NOT NULL DEFAULT 'text'
                  CHECK (content_type IN ('text','image','video')),
  media_url     TEXT,
  thumbnail_url TEXT,
  caption       TEXT,
  view_count    INTEGER NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moment_views (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  moment_id UUID NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(moment_id, viewer_id)
);

CREATE TABLE IF NOT EXISTS moment_reactions (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  moment_id UUID NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji     TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(moment_id, user_id)
);


-- ============================================================
-- SECTION 4: Guilds
-- ============================================================

CREATE TABLE IF NOT EXISTS guilds (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT NOT NULL UNIQUE,
  crest_emoji      TEXT NOT NULL DEFAULT '🛡️',
  description      TEXT,
  city             TEXT,
  country          TEXT DEFAULT 'NG',
  captain_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tier             TEXT NOT NULL DEFAULT 'bronze_1' CHECK (tier IN (
    'bronze_1','bronze_2','bronze_3',
    'silver_1','silver_2','silver_3',
    'gold_1','gold_2','gold_3',
    'platinum_1','platinum_2','platinum_3',
    'legend'
  )),
  guild_xp           BIGINT  NOT NULL DEFAULT 0,
  member_count       INTEGER NOT NULL DEFAULT 1,
  treasury_balance   BIGINT  NOT NULL DEFAULT 0,
  treasury_cap       BIGINT  NOT NULL DEFAULT 50000,
  recruitment_type   TEXT NOT NULL DEFAULT 'open'
                       CHECK (recruitment_type IN ('open','approval','invite_only')),
  wars_won           INTEGER NOT NULL DEFAULT 0,
  wars_lost          INTEGER NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  last_war_ended_at  TIMESTAMPTZ,
  below_min_since    TIMESTAMPTZ,
  below_minimum_days INTEGER NOT NULL DEFAULT 0,
  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_guild_id_fkey
    FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS guild_members (
  id                               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id                         UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id                          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                             TEXT NOT NULL DEFAULT 'member'
                                     CHECK (role IN ('captain','veteran','recruiter','member')),
  contribution_score               INTEGER NOT NULL DEFAULT 0,
  war_points_total                 INTEGER NOT NULL DEFAULT 0,
  contribution_below_average_weeks INTEGER NOT NULL DEFAULT 0,
  joined_at                        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS guild_wars (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenger_guild_id  UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  defender_guild_id    UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','final_hour','completed','cancelled')),
  challenger_points    BIGINT NOT NULL DEFAULT 0,
  defender_points      BIGINT NOT NULL DEFAULT 0,
  winner_guild_id      UUID REFERENCES guilds(id),
  starts_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at              TIMESTAMPTZ NOT NULL,
  final_hour_starts_at TIMESTAMPTZ NOT NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS war_contributions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  war_id     UUID NOT NULL REFERENCES guild_wars(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guild_id   UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  war_points INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(war_id, user_id)
);

CREATE TABLE IF NOT EXISTS guild_quests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id        UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  quest_type      TEXT NOT NULL DEFAULT 'collective',
  target_count    INTEGER NOT NULL DEFAULT 100,
  current_count   INTEGER NOT NULL DEFAULT 0,
  reward_guild_xp INTEGER NOT NULL DEFAULT 500,
  reward_coins    INTEGER NOT NULL DEFAULT 200,
  week_start      TIMESTAMPTZ NOT NULL,
  week_end        TIMESTAMPTZ NOT NULL,
  is_completed    BOOLEAN DEFAULT false,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT guild_quests_week_start_is_monday
    CHECK (EXTRACT(ISODOW FROM week_start AT TIME ZONE 'UTC') = 1)
);

CREATE TABLE IF NOT EXISTS guild_quest_contributions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quest_id   UUID NOT NULL REFERENCES guild_quests(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_war_rematch_tokens (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id         UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  war_id           UUID NOT NULL REFERENCES guild_wars(id) ON DELETE CASCADE,
  discount_percent INTEGER NOT NULL DEFAULT 50,
  is_used          BOOLEAN DEFAULT false,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_applications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id    UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS guild_invites (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id        UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,
  invited_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  used_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_treasury_ledger (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id         UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  amount           BIGINT NOT NULL,
  balance_before   BIGINT NOT NULL,
  balance_after    BIGINT NOT NULL,
  transaction_type TEXT NOT NULL,
  description      TEXT,
  reference_id     TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_tier_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id    UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  from_tier   TEXT NOT NULL,
  to_tier     TEXT NOT NULL,
  guild_xp_at BIGINT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_alliances (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  founded_by  UUID NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  is_active   BOOLEAN DEFAULT true,
  wars_won    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_alliance_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alliance_id UUID NOT NULL REFERENCES guild_alliances(id) ON DELETE CASCADE,
  guild_id    UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(alliance_id, guild_id)
);

CREATE TABLE IF NOT EXISTS alliance_wars (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alliance_1_id      UUID NOT NULL REFERENCES guild_alliances(id) ON DELETE CASCADE,
  alliance_2_id      UUID NOT NULL REFERENCES guild_alliances(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  winner_alliance_id UUID REFERENCES guild_alliances(id) ON DELETE SET NULL,
  alliance_1_xp      BIGINT NOT NULL DEFAULT 0,
  alliance_2_xp      BIGINT NOT NULL DEFAULT 0,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS guild_contribution_alerts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id    UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weeks_below INTEGER NOT NULL DEFAULT 1,
  alerted_at  TIMESTAMPTZ DEFAULT NOW(),
  resolved    BOOLEAN DEFAULT false,
  UNIQUE(guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS guild_messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id   UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  sender_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
  type       TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','sticker','gif')),
  sticker_id TEXT,
  gif_url    TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- SECTION 5: Rooms
-- ============================================================

CREATE TABLE IF NOT EXISTS rooms (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  description TEXT,
  type        TEXT NOT NULL DEFAULT 'free_open'
                CHECK (type IN ('free_open','vip','drop','tipping','classroom','guild')),
  category    TEXT,
  city        TEXT,
  cover_image_url TEXT,
  cover_emoji     TEXT NOT NULL DEFAULT '💬',

  -- Access
  is_public    BOOLEAN DEFAULT true,
  max_members  INTEGER,
  member_count INTEGER NOT NULL DEFAULT 0,

  -- Pricing
  subscription_price_kobo BIGINT,
  entry_fee_kobo          BIGINT,
  subscription_price_ngn  BIGINT,
  entry_fee_ngn           BIGINT,
  enrolment_fee_ngn       BIGINT,

  -- ClassRoom
  curriculum       JSONB,
  starts_at        TIMESTAMPTZ,
  ends_at          TIMESTAMPTZ,
  class_start_date DATE,
  class_end_date   DATE,

  -- Drop Room
  drop_starts_at TIMESTAMPTZ,
  drop_ends_at   TIMESTAMPTZ,

  -- Guild
  guild_id UUID REFERENCES guilds(id) ON DELETE SET NULL,

  -- Stats
  total_messages INTEGER NOT NULL DEFAULT 0,
  health_score   INTEGER DEFAULT 100,

  -- Spotlight & moderation
  spotlight_until           TIMESTAMPTZ,
  spotlight_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  moderation_rules          JSONB,
  spectacle_threshold_coins INTEGER,

  -- Ad revenue
  is_ad_enrolled BOOLEAN NOT NULL DEFAULT false,

  -- Flags
  is_active    BOOLEAN DEFAULT true,
  is_featured  BOOLEAN DEFAULT false,
  is_sponsored BOOLEAN DEFAULT false,
  sponsored_by TEXT,
  metadata     JSONB,
  deleted_at   TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member'
                CHECK (role IN ('creator','admin','co_moderator','member')),
  is_muted    BOOLEAN NOT NULL DEFAULT false,
  muted_until TIMESTAMPTZ,
  left_at     TIMESTAMPTZ,
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS room_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id         UUID REFERENCES rooms(id) ON DELETE CASCADE,
  group_chat_id   UUID REFERENCES group_chats(id) ON DELETE CASCADE,
  conversation_id UUID,
  message_type    TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN (
    'text','sticker','gif','gift','moment','system','broadcast'
  )),
  content      TEXT,
  media_url    TEXT,
  metadata     JSONB,
  coin_cost    BIGINT DEFAULT 0,
  reply_count_from_recipient INTEGER DEFAULT 0,
  is_deleted   BOOLEAN DEFAULT false,
  is_flagged   BOOLEAN DEFAULT false,
  is_pinned    BOOLEAN DEFAULT false,
  pinned_at    TIMESTAMPTZ,
  pinned_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  pin_expires_at TIMESTAMPTZ,
  is_pending_approval BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_reactions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  is_custom  BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS room_message_reactions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS room_member_highlights (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id        UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  highlighted_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS room_moderation_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id        UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  moderator_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  metadata       JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_subscriptions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  amount_kobo BIGINT,
  started_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_promotions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE UNIQUE,
  creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  promoted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  coin_cost   INTEGER NOT NULL DEFAULT 0,
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at     TIMESTAMPTZ NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_monthly_active_users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  month      DATE NOT NULL,
  mau_count  INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(room_id, month)
);

CREATE TABLE IF NOT EXISTS room_pins (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, room_id)
);

CREATE TABLE IF NOT EXISTS guild_rooms (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id   UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(guild_id, room_id)
);

CREATE TABLE IF NOT EXISTS drop_room_replays (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE UNIQUE,
  creator_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  highlights      JSONB NOT NULL,
  replay_fee_kobo BIGINT NOT NULL DEFAULT 0,
  is_published    BOOLEAN DEFAULT false,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branded_rooms (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id              UUID REFERENCES rooms(id) ON DELETE SET NULL,
  brand_name           TEXT NOT NULL,
  brand_logo_url       TEXT,
  sponsor_budget_coins INTEGER NOT NULL DEFAULT 0,
  join_bonus_coins     INTEGER NOT NULL DEFAULT 5,
  is_active            BOOLEAN DEFAULT true,
  starts_at            TIMESTAMPTZ,
  ends_at              TIMESTAMPTZ,
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- SECTION 6: Quests, Seasons & Progression
-- ============================================================

CREATE TABLE IF NOT EXISTS quest_templates (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title         TEXT NOT NULL UNIQUE,
  description   TEXT NOT NULL,
  action_type   TEXT NOT NULL,
  target_count  INTEGER NOT NULL,
  xp_reward     INTEGER NOT NULL DEFAULT 0,
  coin_reward   INTEGER NOT NULL DEFAULT 0,
  track         TEXT DEFAULT 'main',
  plan_required TEXT DEFAULT 'free',
  category      TEXT NOT NULL DEFAULT 'general',
  icon          TEXT,
  valid_date    DATE,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_quests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_template_id UUID NOT NULL REFERENCES quest_templates(id) ON DELETE CASCADE,
  date              DATE NOT NULL,
  progress          INTEGER NOT NULL DEFAULT 0,
  target            INTEGER NOT NULL,
  is_completed      BOOLEAN DEFAULT false,
  completed_at      TIMESTAMPTZ,
  xp_reward         INTEGER NOT NULL,
  coin_reward       INTEGER NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, quest_template_id, date)
);

CREATE TABLE IF NOT EXISTS user_quest_progress (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_id       UUID NOT NULL REFERENCES quest_templates(id) ON DELETE CASCADE,
  quest_date     DATE NOT NULL,
  progress_count INTEGER NOT NULL DEFAULT 0,
  completed      BOOLEAN NOT NULL DEFAULT false,
  completed_at   TIMESTAMPTZ,
  expired_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, quest_id, quest_date)
);

CREATE TABLE IF NOT EXISTS seasons (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT NOT NULL,
  theme            TEXT,
  description      TEXT,
  season_number    INTEGER NOT NULL,
  starts_at        TIMESTAMPTZ NOT NULL,
  ends_at          TIMESTAMPTZ NOT NULL,
  pass_price_coins  INTEGER NOT NULL DEFAULT 500,
  reward_pool_coins INTEGER NOT NULL DEFAULT 0,
  is_active         BOOLEAN DEFAULT false,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS season_passes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id    UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  tier         TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','paid')),
  season_xp    INTEGER NOT NULL DEFAULT 0,
  season_rank  INTEGER,
  purchased_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, season_id)
);

CREATE TABLE IF NOT EXISTS user_season_passes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id    UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  is_paid      BOOLEAN NOT NULL DEFAULT false,
  season_xp    INTEGER NOT NULL DEFAULT 0,
  season_rank  INTEGER,
  purchased_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, season_id)
);

CREATE TABLE IF NOT EXISTS season_pass_milestones (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id     UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  milestone_xp  INTEGER NOT NULL,
  tier          TEXT NOT NULL DEFAULT 'free',
  reward_type   TEXT NOT NULL,
  reward_value  JSONB NOT NULL DEFAULT '{}',
  display_name  TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  required_plan TEXT DEFAULT NULL CHECK (required_plan IN ('pro','max')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_season_pass_claims (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id    UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  milestone_id UUID NOT NULL REFERENCES season_pass_milestones(id) ON DELETE CASCADE,
  claimed_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, milestone_id)
);

CREATE TABLE IF NOT EXISTS user_season_milestone_claims (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id    UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  milestone_id UUID NOT NULL REFERENCES season_pass_milestones(id) ON DELETE CASCADE,
  claimed_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, season_id, milestone_id)
);

CREATE TABLE IF NOT EXISTS season_rank_archives (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id       UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  final_rank      INTEGER,
  final_season_xp INTEGER NOT NULL DEFAULT 0,
  archived_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, user_id)
);

CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track         TEXT NOT NULL DEFAULT 'main',
  scope         TEXT NOT NULL DEFAULT 'global',
  city          TEXT,
  season_id     UUID REFERENCES seasons(id) ON DELETE CASCADE,
  xp_value      BIGINT NOT NULL DEFAULT 0,
  rank_position INTEGER,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, track, scope, city, season_id)
);

CREATE TABLE IF NOT EXISTS leaderboard_rank_snapshots (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope      TEXT NOT NULL DEFAULT 'global',
  rank       INTEGER NOT NULL,
  xp         BIGINT NOT NULL DEFAULT 0,
  snapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, scope)
);

CREATE TABLE IF NOT EXISTS nemesis_assignments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nemesis_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nemesis_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  track           TEXT NOT NULL DEFAULT 'main',
  assigned_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  dismissed_at    TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, track, is_active)
);

CREATE TABLE IF NOT EXISTS nemesis_challenges (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenger_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenged_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','declined','completed','expired')),
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_badges (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_type   TEXT,
  badge_key    TEXT,
  reference_id TEXT,
  metadata     JSONB,
  awarded_at   TIMESTAMPTZ DEFAULT NOW(),
  granted_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_badges_key
  ON user_badges(user_id, badge_key) WHERE badge_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_titles (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  source     TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT false,
  awarded_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, title)
);

CREATE TABLE IF NOT EXISTS track_milestone_unlocks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track           TEXT NOT NULL,
  milestone_level INTEGER NOT NULL,
  unlock_key      TEXT,
  unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, track, milestone_level)
);

CREATE TABLE IF NOT EXISTS rank_up_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank_from   TEXT NOT NULL,
  rank_to     TEXT NOT NULL,
  xp_at_event BIGINT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS xp_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  xp_awarded INTEGER NOT NULL,
  track      TEXT NOT NULL DEFAULT 'main',
  metadata   JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hall_of_fame (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  prestige_count INTEGER NOT NULL,
  legacy_score   BIGINT NOT NULL DEFAULT 0,
  inducted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS new_member_quests (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_type     TEXT NOT NULL DEFAULT 'new_member',
  progress       JSONB NOT NULL DEFAULT '{}',
  completed      BOOLEAN NOT NULL DEFAULT FALSE,
  reward_claimed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, quest_type)
);


-- ============================================================
-- SECTION 7: Economy (Ledgers, Payments, Gifts, Store)
-- ============================================================

CREATE TABLE IF NOT EXISTS coin_ledger (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount           BIGINT NOT NULL,
  balance_before   BIGINT NOT NULL,
  balance_after    BIGINT NOT NULL,
  transaction_type TEXT NOT NULL,
  reference_id     TEXT,
  description      TEXT,
  metadata         JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS star_ledger (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount           INT NOT NULL,
  balance_before   BIGINT NOT NULL DEFAULT 0,
  balance_after    BIGINT NOT NULL DEFAULT 0,
  transaction_type TEXT NOT NULL,
  description      TEXT,
  reference_id     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS xp_ledger (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount           INTEGER NOT NULL,
  track            TEXT NOT NULL DEFAULT 'main',
  source           TEXT NOT NULL,
  action           TEXT,
  xp_amount        INTEGER,
  xp_net           INTEGER,
  reference_id     TEXT,
  multiplier       DECIMAL(4,2) DEFAULT 1.0,
  base_amount      INTEGER NOT NULL,
  description      TEXT,
  ceremony_room_id UUID,
  metadata         JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_type            TEXT NOT NULL CHECK (payment_type IN (
    'coin_purchase','subscription','season_pass','booster_pack','room_entry'
  )),
  amount_kobo             BIGINT NOT NULL,
  currency                TEXT NOT NULL DEFAULT 'NGN',
  provider                TEXT NOT NULL
                            CHECK (provider IN ('paystack','dodopayments','google_play')),
  provider_reference      TEXT UNIQUE,
  provider_transaction_id TEXT,
  status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','processing','completed','failed','refunded'
  )),
  coins_credited       BIGINT,
  amount_received_kobo BIGINT,
  idempotency_key      TEXT UNIQUE,
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS gift_items (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                      TEXT NOT NULL UNIQUE,
  emoji                     TEXT NOT NULL,
  coin_price                INTEGER NOT NULL,
  coin_cost                 INTEGER NOT NULL DEFAULT 0,
  tier                      INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 3),
  spectacle_threshold_coins INTEGER,
  animation_url             TEXT,
  is_limited_edition        BOOLEAN DEFAULT false,
  season_id                 UUID REFERENCES seasons(id) ON DELETE SET NULL,
  is_retired                BOOLEAN DEFAULT false,
  is_active                 BOOLEAN DEFAULT true,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gifts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id      UUID REFERENCES rooms(id) ON DELETE SET NULL,
  gift_item_id UUID NOT NULL REFERENCES gift_items(id) ON DELETE RESTRICT,
  coin_value   INTEGER NOT NULL,
  coin_cost    INTEGER NOT NULL,
  animation_url TEXT,
  message_id   UUID REFERENCES messages(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'delivered'
                 CHECK (status IN ('delivered','failed','refunded')),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL UNIQUE,
  description       TEXT,
  item_type         TEXT NOT NULL
                      CHECK (item_type IN ('coin_pack','star_pack','booster','cosmetic')),
  price_kobo        BIGINT,
  currency          TEXT NOT NULL DEFAULT 'NGN',
  coins_cost        INTEGER,
  stars_cost        INTEGER,
  coins_granted     INTEGER,
  stars_granted     INTEGER,
  cosmetic_type     TEXT,
  bonus_label       TEXT,
  is_featured       BOOLEAN NOT NULL DEFAULT false,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  is_exclusive      BOOLEAN NOT NULL DEFAULT false,
  season_id         UUID REFERENCES seasons(id) ON DELETE SET NULL,
  prestige_required INTEGER,
  valid_until       TIMESTAMPTZ,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_active_cosmetic_frame_id_fkey
    FOREIGN KEY (active_cosmetic_frame_id) REFERENCES store_items(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS user_cosmetics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_item_id UUID NOT NULL REFERENCES store_items(id) ON DELETE CASCADE,
  cosmetic_type TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT false,
  acquired_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,
  metadata      JSONB,
  UNIQUE(user_id, store_item_id)
);

CREATE TABLE IF NOT EXISTS user_xp_boosters (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  multiplier DECIMAL(4,2) NOT NULL DEFAULT 2.0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sticker_packs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL UNIQUE,
  description       TEXT,
  cover_emoji       TEXT NOT NULL DEFAULT '🎨',
  cover_sticker_url TEXT,
  pack_type         TEXT NOT NULL DEFAULT 'free'
                      CHECK (pack_type IN ('free','earnable','premium')),
  coin_price        INTEGER NOT NULL DEFAULT 0,
  unlock_condition  TEXT,
  locale            TEXT,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stickers (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pack_id    UUID NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  image_url  TEXT,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pack_id, name)
);

CREATE TABLE IF NOT EXISTS user_sticker_packs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_id     UUID NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
  acquired_at TIMESTAMPTZ DEFAULT NOW(),
  unlocked_at TIMESTAMPTZ,
  UNIQUE(user_id, pack_id)
);

CREATE TABLE IF NOT EXISTS reaction_sets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  coin_price    INT NOT NULL DEFAULT 100,
  preview_emoji TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reaction_set_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id     UUID NOT NULL REFERENCES reaction_sets(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  name       TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_reaction_sets (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id       UUID NOT NULL REFERENCES reaction_sets(id) ON DELETE CASCADE,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, set_id)
);


-- ============================================================
-- SECTION 8: Creator Economy
-- ============================================================

CREATE TABLE IF NOT EXISTS creator_earnings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type       TEXT NOT NULL CHECK (source_type IN (
    'gift','subscription','drop_entry','classroom_enrolment',
    'sponsored_quest','merch','creator_fund','broadcast'
  )),
  gross_amount_kobo BIGINT NOT NULL DEFAULT 0,
  platform_fee_kobo BIGINT NOT NULL DEFAULT 0,
  net_amount_kobo   BIGINT NOT NULL DEFAULT 0,
  reference_id      TEXT,
  paid_out          BOOLEAN DEFAULT false,
  payout_id         UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creator_payouts (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_kobo              BIGINT NOT NULL,
  gross_kobo               BIGINT,
  net_kobo                 BIGINT,
  platform_fee_kobo        BIGINT,
  provider                 TEXT NOT NULL,
  bank_account_reference   TEXT,
  bank_account_last4       TEXT,
  bank_account_snapshot    JSONB,
  wallet_address_snapshot  TEXT,
  payout_method            TEXT DEFAULT 'bank_transfer'
                             CHECK (payout_method IN ('bank_transfer','coins','crypto')),
  region                   TEXT DEFAULT 'nigeria'
                             CHECK (region IN ('nigeria','global')),
  status                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','awaiting_approval','approved','processing',
    'completed','failed','rejected','reversed','cancelled'
  )),
  requires_manual_approval BOOLEAN DEFAULT false,
  approved_by_admin_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key          TEXT UNIQUE,
  provider_reference       TEXT,
  provider_status          TEXT,
  retry_count              INTEGER NOT NULL DEFAULT 0,
  last_retry_at            TIMESTAMPTZ,
  next_retry_at            TIMESTAMPTZ,
  appeal_reason            TEXT,
  appeal_status            TEXT CHECK (appeal_status IN ('pending','resolved','dismissed')),
  appeal_submitted_at      TIMESTAMPTZ,
  appeal_resolved_at       TIMESTAMPTZ,
  appeal_resolved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  earnings_restored        BOOLEAN NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  processed_at             TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ DEFAULT NOW(),
  completed_at             TIMESTAMPTZ
);

-- creator_earnings.payout_id -> creator_payouts (forward ref: creator_payouts defined above)
DO $$ BEGIN
  ALTER TABLE creator_earnings ADD CONSTRAINT creator_earnings_payout_id_fkey
    FOREIGN KEY (payout_id) REFERENCES creator_payouts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS creator_bank_accounts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  bank_name            TEXT NOT NULL,
  bank_code            TEXT NOT NULL,
  account_number       TEXT NOT NULL,
  account_name         TEXT NOT NULL,
  account_number_last4 TEXT NOT NULL,
  recipient_code       TEXT,
  xp_awarded           BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creator_wallet_addresses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  network    TEXT NOT NULL DEFAULT 'tron',
  currency   TEXT NOT NULL DEFAULT 'USDT',
  address    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payout_dead_letter_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id         UUID NOT NULL REFERENCES creator_payouts(id) ON DELETE CASCADE,
  creator_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  failure_reason    TEXT,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  last_attempted_at TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  resolution_note   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creator_kyc (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  full_name           TEXT,
  bvn_last4           TEXT,
  bank_account_number TEXT,
  bank_code           TEXT,
  bank_name           TEXT,
  kyc_status          TEXT NOT NULL DEFAULT 'unverified'
                        CHECK (kyc_status IN ('unverified','pending','verified','rejected')),
  is_encrypted        BOOLEAN NOT NULL DEFAULT false,
  verified_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier         INTEGER NOT NULL DEFAULT 1 CHECK (tier IN (1,2)),
  qualified    BOOLEAN NOT NULL DEFAULT false,
  qualified_at TIMESTAMPTZ,
  coin_reward  INTEGER,
  xp_reward    INTEGER,
  rewarded_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(referrer_id, referred_id)
);

CREATE TABLE IF NOT EXISTS referral_commissions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger_event_id     TEXT NOT NULL,
  purchase_amount_kobo BIGINT NOT NULL,
  commission_kobo      BIGINT NOT NULL,
  commission_coins     INTEGER NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'pending',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  credited_at          TIMESTAMPTZ,
  UNIQUE(trigger_event_id)
);

CREATE TABLE IF NOT EXISTS sponsored_quests (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_name             TEXT NOT NULL,
  title                  TEXT NOT NULL,
  description            TEXT NOT NULL,
  target_action          TEXT NOT NULL,
  target_value           INTEGER NOT NULL,
  reward_coins           INTEGER NOT NULL,
  creator_payout_kobo    BIGINT NOT NULL,
  platform_fee_kobo      BIGINT NOT NULL,
  platform_share_percent INTEGER NOT NULL DEFAULT 30,
  creator_share_percent  INTEGER NOT NULL DEFAULT 70,
  min_creator_tier       TEXT NOT NULL DEFAULT 'verified',
  starts_at              TIMESTAMPTZ,
  ends_at                TIMESTAMPTZ,
  is_active              BOOLEAN DEFAULT true,
  max_creators           INTEGER DEFAULT 10,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sponsored_quest_applications (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quest_id         UUID NOT NULL REFERENCES sponsored_quests(id) ON DELETE CASCADE,
  creator_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id          UUID REFERENCES rooms(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','applied','accepted','completed','approved','rejected','paid'
  )),
  progress         INTEGER NOT NULL DEFAULT 0,
  completion_proof TEXT,
  completed_at     TIMESTAMPTZ,
  approved_at      TIMESTAMPTZ,
  payout_id        UUID REFERENCES creator_payouts(id) ON DELETE SET NULL,
  payout_coins     INTEGER,
  paid_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(quest_id, creator_id)
);

CREATE TABLE IF NOT EXISTS creator_broadcasts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject         TEXT,
  content         TEXT NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  cost_coins      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creator_spotlights (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_year TEXT NOT NULL,
  blurb      TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_creator_spotlight_month UNIQUE (month_year)
);

CREATE TABLE IF NOT EXISTS merch_stores (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  name                      TEXT NOT NULL,
  description               TEXT,
  is_active                 BOOLEAN DEFAULT true,
  physical_goods_enabled    BOOLEAN DEFAULT false,
  default_fulfillment_method TEXT DEFAULT 'manual'
    CHECK (default_fulfillment_method IN ('manual', 'partner')),
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS merch_products (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id     UUID NOT NULL REFERENCES merch_stores(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  product_type TEXT NOT NULL DEFAULT 'digital'
                 CHECK (product_type IN ('digital','physical','course_material')),
  price_kobo   BIGINT NOT NULL,
  image_url    TEXT,
  is_active    BOOLEAN DEFAULT true,
  stock        INTEGER,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS merch_orders (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id         UUID NOT NULL REFERENCES merch_products(id) ON DELETE RESTRICT,
  buyer_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_kobo        BIGINT NOT NULL,
  creator_share_kobo BIGINT NOT NULL,
  platform_fee_kobo  BIGINT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','shipped','in_transit','delivered','completed','refunded')),
  shipping_name      TEXT,
  shipping_address   TEXT,
  shipping_city      TEXT,
  shipping_country   TEXT,
  fulfillment_method TEXT DEFAULT 'manual'
    CHECK (fulfillment_method IN ('manual', 'partner')),
  seller_notes       TEXT,
  shipped_at         TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  confirmed_at       TIMESTAMPTZ,
  tracking_updates   JSONB DEFAULT '[]'::jsonb,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classroom_enrolments (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id               UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paid                  BOOLEAN NOT NULL DEFAULT false,
  fee_kobo              BIGINT NOT NULL DEFAULT 0,
  enrolled_at           TIMESTAMPTZ DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  certificate_issued    BOOLEAN DEFAULT false,
  certificate_issued_at TIMESTAMPTZ,
  UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS classroom_quizzes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  xp_reward   INTEGER NOT NULL DEFAULT 50,
  pass_score  INTEGER NOT NULL DEFAULT 70,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classroom_quiz_questions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quiz_id        UUID NOT NULL REFERENCES classroom_quizzes(id) ON DELETE CASCADE,
  question       TEXT NOT NULL,
  option_a       TEXT NOT NULL,
  option_b       TEXT NOT NULL,
  option_c       TEXT NOT NULL,
  option_d       TEXT NOT NULL,
  correct_option TEXT NOT NULL CHECK (correct_option IN ('a','b','c','d')),
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classroom_quiz_attempts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quiz_id      UUID NOT NULL REFERENCES classroom_quizzes(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score        INTEGER NOT NULL,
  passed       BOOLEAN NOT NULL,
  answers      JSONB NOT NULL,
  xp_awarded   INTEGER DEFAULT 0,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(quiz_id, user_id)
);

CREATE TABLE IF NOT EXISTS learning_certificates (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  classroom_room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  student_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issuer_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  issued_at         TIMESTAMPTZ DEFAULT NOW(),
  certificate_url   TEXT,
  metadata          JSONB,
  UNIQUE(classroom_room_id, student_id)
);

CREATE TABLE IF NOT EXISTS elder_requests (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mentee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  elder_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message    TEXT,
  status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','accepted','rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mentee_id, elder_id)
);

CREATE TABLE IF NOT EXISTS elder_mentorships (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  elder_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mentee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','completed','terminated')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at   TIMESTAMPTZ,
  UNIQUE(elder_id, mentee_id)
);


-- ============================================================
-- SECTION 9: Announcements, Admin & Communication
-- ============================================================

CREATE TABLE IF NOT EXISTS announcement_modals (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  content_type  TEXT NOT NULL DEFAULT 'html' CHECK (content_type IN ('html','text')),
  is_active     BOOLEAN DEFAULT false,
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  target_plans  TEXT[] DEFAULT ARRAY['free','plus','pro','max'],
  target_roles  TEXT[] DEFAULT ARRAY[]::TEXT[],
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcement_banners (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content       TEXT NOT NULL,
  content_type  TEXT NOT NULL DEFAULT 'html' CHECK (content_type IN ('html','text')),
  is_active     BOOLEAN DEFAULT false,
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  target_plans  TEXT[] DEFAULT ARRAY['free','plus','pro','max'],
  target_roles  TEXT[] DEFAULT ARRAY[]::TEXT[],
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_modal_views (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  modal_id  UUID NOT NULL REFERENCES announcement_modals(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, modal_id)
);

CREATE TABLE IF NOT EXISTS user_banner_views (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banner_id UUID NOT NULL REFERENCES announcement_banners(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, banner_id)
);

CREATE TABLE IF NOT EXISTS user_announcement_rotation (
  user_id        UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type   TEXT    NOT NULL CHECK (content_type IN ('modal', 'banner')),
  last_shown_id  UUID    NOT NULL,
  last_shown_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, content_type)
);

CREATE TABLE IF NOT EXISTS admin_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject         TEXT,
  body            TEXT NOT NULL,
  broadcast_type  TEXT NOT NULL DEFAULT 'direct'
                    CHECK (broadcast_type IN ('direct','all','by_plan','by_role')),
  target_plans    TEXT[],
  target_roles    TEXT[],
  target_user_ids UUID[],
  recipient_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_message_receipts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_message_id UUID NOT NULL REFERENCES admin_messages(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_delivered     BOOLEAN DEFAULT false,
  is_read          BOOLEAN DEFAULT false,
  delivered_at     TIMESTAMPTZ,
  read_at          TIMESTAMPTZ,
  UNIQUE(admin_message_id, user_id)
);

CREATE TABLE IF NOT EXISTS telegram_delivery_queue (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  broadcast_id    UUID REFERENCES admin_messages(id) ON DELETE CASCADE,
  telegram_ids    JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','done','failed')),
  delivered_at    TIMESTAMPTZ,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS footer_scripts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  is_active  BOOLEAN DEFAULT true,
  position   INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_actions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  reason         TEXT,
  duration_hours INTEGER,
  metadata       JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  resource    TEXT,
  resource_id TEXT,
  before_val  JSONB,
  after_val   JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, role)
);

CREATE TABLE IF NOT EXISTS system_alerts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type            TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'info'
                    CHECK (severity IN ('info','warning','critical')),
  message         TEXT NOT NULL,
  metadata        JSONB,
  resolved        BOOLEAN NOT NULL DEFAULT false,
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moderation_ai_escalations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id  UUID NOT NULL REFERENCES moderation_reports(id) ON DELETE CASCADE,
  admin_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  verdict    TEXT NOT NULL CHECK (verdict IN ('violation','borderline','no_violation')),
  confidence NUMERIC(4,3) NOT NULL,
  reasoning  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SECTION 10: Subscriptions & Plans
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                     TEXT NOT NULL CHECK (plan IN ('plus','pro','max')),
  billing_period           TEXT NOT NULL DEFAULT 'monthly'
                             CHECK (billing_period IN ('monthly','annual')),
  status                   TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','cancelled','expired','paused')),
  starts_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at                  TIMESTAMPTZ NOT NULL,
  auto_renew               BOOLEAN DEFAULT true,
  provider                 TEXT,
  provider_subscription_id TEXT,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan       TEXT NOT NULL,
  name       TEXT NOT NULL,
  interval   TEXT NOT NULL DEFAULT 'monthly' CHECK (interval IN ('monthly','annual')),
  price_kobo BIGINT NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'NGN',
  is_active  BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subscription_plans_plan_interval_uq UNIQUE (plan, interval)
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  provider                 TEXT NOT NULL DEFAULT 'paystack',
  provider_subscription_id TEXT,
  status                   TEXT NOT NULL DEFAULT 'active',
  next_renewal_at          TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_accounts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  business_name       TEXT NOT NULL,
  business_type       TEXT,
  tier                TEXT NOT NULL DEFAULT 'starter'
                        CHECK (tier IN ('starter','growth','enterprise')),
  pending_tier        TEXT CHECK (pending_tier IN ('starter','growth','enterprise')),
  pending_payment_ref TEXT,
  tier_updated_at     TIMESTAMPTZ,
  verified            BOOLEAN DEFAULT false,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','cancelled')),
  subscription_id     UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SECTION 11: Moderation & Reports
-- ============================================================

CREATE TABLE IF NOT EXISTS reports (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  reported_message_id UUID REFERENCES room_messages(id) ON DELETE SET NULL,
  reported_room_id    UUID REFERENCES rooms(id) ON DELETE SET NULL,
  reported_guild_id   UUID REFERENCES guilds(id) ON DELETE SET NULL,
  report_type         TEXT NOT NULL CHECK (report_type IN (
    'harassment','spam','fraud','sexual_content','impersonation','hate_speech','other'
  )),
  description     TEXT,
  ai_category     TEXT,
  ai_confidence   DECIMAL(5,4),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','under_review','resolved_action','resolved_dismissed','escalated'
  )),
  moderator_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS moderation_reports (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  reported_message_id UUID,
  reported_room_id    UUID REFERENCES rooms(id) ON DELETE SET NULL,
  reported_guild_id   UUID REFERENCES guilds(id) ON DELETE SET NULL,
  report_type         TEXT NOT NULL DEFAULT 'other',
  description         TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  pipeline_status     TEXT NOT NULL DEFAULT 'manual_queue' CHECK (pipeline_status IN (
    'ai_auto_actioned','community_review','manual_queue','resolved'
  )),
  ai_category       TEXT,
  ai_confidence     DECIMAL(5,4),
  ai_recommendation TEXT,
  ai_provider       TEXT,
  ai_classified_at  TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note   TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  moderator_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  action_type    TEXT NOT NULL CHECK (action_type IN (
    'warn','suspend','ban','remove_content','escalate','dismiss'
  )),
  reason     TEXT,
  report_id  UUID REFERENCES reports(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SECTION 12: Cultural Events, Scheduling & Community
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_events (
  id                            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                          TEXT NOT NULL UNIQUE,
  description                   TEXT,
  event_type                    TEXT NOT NULL DEFAULT 'cultural' CHECK (event_type IN (
    'cultural','season_launch','flash_xp','guild_war_event','mystery_drop','platform'
  )),
  xp_multiplier                 DECIMAL(3,1) DEFAULT 1.0,
  coin_bonus_pct                INTEGER DEFAULT 0,
  starts_at                     TIMESTAMPTZ NOT NULL,
  ends_at                       TIMESTAMPTZ NOT NULL,
  is_active                     BOOLEAN DEFAULT true,
  target_cities                 TEXT[],
  is_recurring_annual           BOOLEAN NOT NULL DEFAULT false,
  recurrence_anchor_month_start INT,
  recurrence_anchor_day_start   INT,
  recurrence_anchor_month_end   INT,
  recurrence_anchor_day_end     INT,
  metadata                      JSONB,
  created_at                    TIMESTAMPTZ DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flash_xp_events (
  id                             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                           TEXT NOT NULL,
  multiplier                     DECIMAL(3,1) NOT NULL DEFAULT 2.0,
  announced_at                   TIMESTAMPTZ,
  fires_at                       TIMESTAMPTZ,
  ends_at                        TIMESTAMPTZ NOT NULL,
  is_active                      BOOLEAN DEFAULT true,
  fired                          BOOLEAN DEFAULT false,
  announcement_notification_sent BOOLEAN NOT NULL DEFAULT false,
  notification_sent_at           TIMESTAMPTZ,
  created_at                     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monthly_gift_drops (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gift_item_id    UUID REFERENCES gift_items(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  available_from  TIMESTAMPTZ NOT NULL,
  available_until TIMESTAMPTZ NOT NULL,
  announced_at    TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sponsored_leaderboard_banners (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_name     TEXT NOT NULL,
  sponsor_logo_url TEXT,
  cta_text         TEXT NOT NULL,
  cta_url          TEXT NOT NULL,
  starts_at        TIMESTAMPTZ NOT NULL,
  ends_at          TIMESTAMPTZ NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT false,
  impressions      INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_notes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  target_type     TEXT NOT NULL CHECK (target_type IN ('message','room','user','guild')),
  target_id       UUID NOT NULL,
  author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  helpful_votes   INTEGER NOT NULL DEFAULT 0,
  unhelpful_votes INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'needs_review'
                    CHECK (status IN ('needs_review','shown','hidden')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_note_votes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  note_id    UUID NOT NULL REFERENCES community_notes(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helpful    BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(note_id, user_id)
);

CREATE TABLE IF NOT EXISTS platform_council_members (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  cycle_month  TEXT NOT NULL,
  legacy_score INTEGER NOT NULL,
  joined_at    TIMESTAMPTZ DEFAULT NOW(),
  left_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS platform_council_ideas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  votes       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','selected','implemented','rejected')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS council_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at  TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  legacy_score BIGINT NOT NULL DEFAULT 0
);


-- ============================================================
-- SECTION 13: Indexes
-- ============================================================

-- users
CREATE INDEX IF NOT EXISTS idx_users_username     ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email        ON users(email)       WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_google_id    ON users(google_id)   WHERE google_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_telegram_id  ON users(telegram_id) WHERE telegram_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_city         ON users(city)        WHERE city IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_plan         ON users(plan);
CREATE INDEX IF NOT EXISTS idx_users_xp_total     ON users(xp_total DESC);
CREATE INDEX IF NOT EXISTS idx_users_last_active  ON users(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_referred_by  ON users(referred_by) WHERE referred_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_deleted_at   ON users(deleted_at)  WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_prestige_boost ON users(prestige_cycle_boost_expires_at)
  WHERE prestige_cycle_boost_expires_at IS NOT NULL;

-- ledgers
CREATE INDEX IF NOT EXISTS idx_coin_ledger_user_id    ON coin_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_coin_ledger_created_at ON coin_ledger(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_coin_ledger_type_ref ON coin_ledger(transaction_type, reference_id)
  WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_star_ledger_user       ON star_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_star_ledger_created_at ON star_ledger(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_star_ledger_type_ref ON star_ledger(transaction_type, reference_id)
  WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_xp_ledger_user_id      ON xp_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_xp_ledger_track        ON xp_ledger(track);
CREATE INDEX IF NOT EXISTS idx_xp_ledger_created_at   ON xp_ledger(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_xp_ledger_action       ON xp_ledger(action);

-- sessions
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- social
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower      ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following     ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_user1 ON dm_conversations(user_id_1);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_user2 ON dm_conversations(user_id_2);
CREATE INDEX IF NOT EXISTS idx_conversation_scores_u1 ON conversation_scores(user_id_1);
CREATE INDEX IF NOT EXISTS idx_conversation_scores_u2 ON conversation_scores(user_id_2);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker    ON user_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked    ON user_blocks(blocked_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id     ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at  ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_messages_recipient   ON user_messages(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_messages_unread      ON user_messages(recipient_id) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_moments_user       ON moments(user_id);
CREATE INDEX IF NOT EXISTS idx_moments_expires_at ON moments(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_sender_dm    ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_dm ON messages(recipient_id) WHERE recipient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_conversation  ON messages(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_sender_plan_created ON messages(sender_plan_at_creation, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(conversation_id, recipient_id, is_read, is_deleted)
  WHERE is_read = false AND is_deleted = false;

-- guilds
CREATE INDEX IF NOT EXISTS idx_guilds_tier          ON guilds(tier);
CREATE INDEX IF NOT EXISTS idx_guilds_city          ON guilds(city);
CREATE INDEX IF NOT EXISTS idx_guild_members_guild  ON guild_members(guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_members_user   ON guild_members(user_id);
CREATE INDEX IF NOT EXISTS idx_guild_applications_guild ON guild_applications(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_guild_applications_user  ON guild_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_guild_invites_guild  ON guild_invites(guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_invites_token  ON guild_invites(token);
CREATE INDEX IF NOT EXISTS idx_guild_treasury_ledger_guild ON guild_treasury_ledger(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guild_treasury_ledger_ref   ON guild_treasury_ledger(reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guild_quests_guild_week     ON guild_quests(guild_id, week_start);
CREATE INDEX IF NOT EXISTS idx_guild_quest_contributions_quest ON guild_quest_contributions(quest_id);
CREATE INDEX IF NOT EXISTS idx_guild_quest_contributions_user  ON guild_quest_contributions(user_id);
CREATE INDEX IF NOT EXISTS idx_rematch_tokens_guild ON guild_war_rematch_tokens(guild_id) WHERE NOT is_used;
CREATE INDEX IF NOT EXISTS idx_guild_contribution_alerts_guild ON guild_contribution_alerts(guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_messages_guild ON guild_messages(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guild_messages_sender ON guild_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_war_contributions_war  ON war_contributions(war_id);
CREATE INDEX IF NOT EXISTS idx_war_contributions_user ON war_contributions(user_id);
CREATE INDEX IF NOT EXISTS idx_guild_rooms_room ON guild_rooms(room_id);
CREATE INDEX IF NOT EXISTS idx_hall_of_fame_user ON hall_of_fame(user_id);
CREATE INDEX IF NOT EXISTS idx_hall_of_fame_legacy ON hall_of_fame(legacy_score DESC);
CREATE INDEX IF NOT EXISTS new_member_quests_user_id_idx ON new_member_quests(user_id);

-- rooms
CREATE INDEX IF NOT EXISTS idx_rooms_creator_id ON rooms(creator_id);
CREATE INDEX IF NOT EXISTS idx_rooms_city       ON rooms(city);
CREATE INDEX IF NOT EXISTS idx_rooms_type       ON rooms(type);
CREATE INDEX IF NOT EXISTS idx_rooms_is_active  ON rooms(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_rooms_guild_id   ON rooms(guild_id)  WHERE guild_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rooms_spotlight  ON rooms(spotlight_until) WHERE spotlight_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_room_messages_room       ON room_messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_messages_created_at ON room_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_room_messages_sender     ON room_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_room_messages_pinned  ON room_messages(room_id) WHERE is_pinned = true;
CREATE INDEX IF NOT EXISTS idx_room_messages_pin_expiry ON room_messages(pin_expires_at)
  WHERE is_pinned = true AND pin_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_room_msg_reactions_msg  ON room_message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_room_msg_reactions_user ON room_message_reactions(user_id);
CREATE INDEX IF NOT EXISTS idx_room_member_highlights_room ON room_member_highlights(room_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_room_mod_log_room   ON room_moderation_log(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_mod_log_target ON room_moderation_log(target_user_id)
  WHERE target_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_room_subscriptions_room   ON room_subscriptions(room_id, status);
CREATE INDEX IF NOT EXISTS idx_room_subscriptions_user   ON room_subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_room_subscriptions_expiry ON room_subscriptions(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_room_promotions_active    ON room_promotions(room_id, is_active, ends_at);
CREATE INDEX IF NOT EXISTS idx_room_mau_room_id          ON room_monthly_active_users(room_id, month DESC);
CREATE INDEX IF NOT EXISTS idx_room_pins_user ON room_pins(user_id);
CREATE INDEX IF NOT EXISTS idx_room_pins_room ON room_pins(room_id);

-- quests & progression
CREATE INDEX IF NOT EXISTS idx_user_quests_user_date ON user_quests(user_id, date);
CREATE INDEX IF NOT EXISTS idx_user_quest_progress_user_date ON user_quest_progress(user_id, quest_date);
CREATE INDEX IF NOT EXISTS idx_season_pass_milestones_season ON season_pass_milestones(season_id, milestone_xp);
CREATE INDEX IF NOT EXISTS idx_user_season_pass_claims_user_season ON user_season_pass_claims(user_id, season_id);
CREATE INDEX IF NOT EXISTS idx_season_milestone_claims ON user_season_milestone_claims(user_id, season_id);
CREATE INDEX IF NOT EXISTS idx_season_rank_archives_season ON season_rank_archives(season_id);
CREATE INDEX IF NOT EXISTS idx_season_rank_archives_user   ON season_rank_archives(user_id);
CREATE INDEX IF NOT EXISTS idx_lb_snapshots_user  ON leaderboard_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_lb_snapshots_scope ON leaderboard_snapshots(scope, track, xp_value DESC);
CREATE INDEX IF NOT EXISTS idx_lb_snapshots_city  ON leaderboard_snapshots(city, track, xp_value DESC)
  WHERE city IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leaderboard_rank_snapshots_user_scope ON leaderboard_rank_snapshots(user_id, scope);
CREATE INDEX IF NOT EXISTS idx_nemesis_user_id ON nemesis_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_nemesis_challenges_challenger ON nemesis_challenges(challenger_id, status);
CREATE INDEX IF NOT EXISTS idx_nemesis_challenges_challenged ON nemesis_challenges(challenged_id, status);
CREATE INDEX IF NOT EXISTS idx_user_titles_user ON user_titles(user_id);
CREATE INDEX IF NOT EXISTS idx_track_milestone_unlocks_user ON track_milestone_unlocks(user_id, track);
CREATE INDEX IF NOT EXISTS idx_rank_up_events_user ON rank_up_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_xp_events_user       ON xp_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_xp_events_action     ON xp_events(action);
CREATE INDEX IF NOT EXISTS idx_xp_events_created_at ON xp_events(created_at);
CREATE INDEX IF NOT EXISTS idx_user_inactivity_notified ON user_inactivity_events(notified, created_at)
  WHERE notified = false;
CREATE INDEX IF NOT EXISTS idx_dm_score_milestones ON dm_conversation_score_milestones(user_id_a, user_id_b);
CREATE INDEX IF NOT EXISTS idx_dm_sticker_unlocks_pair ON dm_score_sticker_unlocks(user_id_1, user_id_2);

-- economy
CREATE INDEX IF NOT EXISTS idx_payments_user_id      ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status       ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_provider_ref ON payments(provider_reference);
CREATE INDEX IF NOT EXISTS idx_creator_earnings_creator ON creator_earnings(creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_payouts_creator  ON creator_payouts(creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_payouts_status   ON creator_payouts(status)
  WHERE status NOT IN ('completed','failed');
CREATE INDEX IF NOT EXISTS idx_creator_payouts_pending_bank ON creator_payouts(created_at ASC)
  WHERE status = 'pending' AND payout_method = 'bank_transfer';
CREATE INDEX IF NOT EXISTS idx_creator_payouts_retry ON creator_payouts(next_retry_at ASC)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_dlq_unresolved ON payout_dead_letter_queue(created_at DESC)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_creator_bank_accounts_creator   ON creator_bank_accounts(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_wallet_addresses_creator ON creator_wallet_addresses(creator_id);
CREATE INDEX IF NOT EXISTS idx_reaction_set_items_set_id  ON reaction_set_items(set_id);
CREATE INDEX IF NOT EXISTS idx_user_reaction_sets_user_id ON user_reaction_sets(user_id);
CREATE INDEX IF NOT EXISTS idx_store_items_type_active    ON store_items(item_type, is_active);
CREATE INDEX IF NOT EXISTS idx_user_cosmetics_user   ON user_cosmetics(user_id, cosmetic_type);
CREATE INDEX IF NOT EXISTS idx_user_cosmetics_active ON user_cosmetics(user_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_xp_boosters_user_active ON user_xp_boosters(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user ON user_push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_user_pins_user        ON user_pins(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_data_export_requests_user   ON data_export_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_data_export_requests_status ON data_export_requests(status)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_user_email_prefs_user ON user_email_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_qualified   ON referrals(referrer_id) WHERE qualified = false;
CREATE INDEX IF NOT EXISTS idx_referral_commissions_referrer ON referral_commissions(referrer_id);

-- creator economy
CREATE INDEX IF NOT EXISTS idx_classroom_enrolments_room ON classroom_enrolments(room_id);
CREATE INDEX IF NOT EXISTS idx_classroom_enrolments_user ON classroom_enrolments(user_id);
CREATE INDEX IF NOT EXISTS idx_learning_certs_student    ON learning_certificates(student_id);
CREATE INDEX IF NOT EXISTS idx_learning_certs_room       ON learning_certificates(classroom_room_id);
CREATE INDEX IF NOT EXISTS idx_elder_mentorships_elder   ON elder_mentorships(elder_id);
CREATE INDEX IF NOT EXISTS idx_elder_mentorships_mentee  ON elder_mentorships(mentee_id);
CREATE INDEX IF NOT EXISTS idx_creator_broadcasts_creator ON creator_broadcasts(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_broadcasts_created ON creator_broadcasts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_ann_rotation_user     ON user_announcement_rotation(user_id);
CREATE INDEX IF NOT EXISTS idx_creator_spotlights_creator  ON creator_spotlights(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_spotlights_is_active ON creator_spotlights(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_creator_spotlights_month    ON creator_spotlights(month_year DESC);
CREATE INDEX IF NOT EXISTS idx_sponsored_banners_active    ON sponsored_leaderboard_banners(is_active, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_merch_orders_creator_status ON merch_orders(creator_id, status);
CREATE INDEX IF NOT EXISTS idx_merch_orders_buyer_status   ON merch_orders(buyer_id, status);

-- moderation
CREATE INDEX IF NOT EXISTS idx_reports_status   ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_reporter ON moderation_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_reported ON moderation_reports(reported_user_id)
  WHERE reported_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_moderation_reports_status   ON moderation_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_pipeline ON moderation_reports(pipeline_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_target   ON moderation_actions(target_user_id);
CREATE INDEX IF NOT EXISTS idx_mod_ai_escalations_report   ON moderation_ai_escalations(report_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin         ON admin_actions(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target        ON admin_actions(target_user_id) WHERE target_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin       ON admin_audit_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_alerts_unresolved    ON system_alerts(severity, created_at DESC) WHERE resolved = false;

-- announcements
CREATE INDEX IF NOT EXISTS idx_user_banner_views_user     ON user_banner_views(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_msg_receipts_user    ON admin_message_receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_login_states_created ON telegram_login_states(created_at);
CREATE INDEX IF NOT EXISTS idx_telegram_delivery_queue_undelivered ON telegram_delivery_queue(created_at ASC)
  WHERE delivered_at IS NULL AND failed_attempts < 3;

-- subscriptions
CREATE INDEX IF NOT EXISTS idx_subscription_plans_active ON subscription_plans(is_active, plan, interval);

-- cultural events
CREATE INDEX IF NOT EXISTS idx_platform_events_recurring ON platform_events(is_recurring_annual, event_type)
  WHERE is_recurring_annual = true;
CREATE INDEX IF NOT EXISTS idx_flash_xp_events_announce ON flash_xp_events(announced_at, announcement_notification_sent, is_active);
CREATE INDEX IF NOT EXISTS idx_flash_xp_events_fires    ON flash_xp_events(fires_at, fired, is_active);
CREATE INDEX IF NOT EXISTS idx_monthly_gift_drops_active ON monthly_gift_drops(available_from, available_until) WHERE is_active;

-- community
CREATE INDEX IF NOT EXISTS idx_community_notes_target ON community_notes(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_council_invitations_user ON council_invitations(user_id);
CREATE INDEX IF NOT EXISTS idx_council_invitations_date ON council_invitations(invited_at DESC);
CREATE INDEX IF NOT EXISTS idx_alliance_wars_active      ON alliance_wars(status) WHERE status = 'active';


-- ============================================================
-- SECTION 14: Row Level Security
-- ============================================================

ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_ledger            ENABLE ROW LEVEL SECURITY;
ALTER TABLE star_ledger            ENABLE ROW LEVEL SECURITY;
ALTER TABLE xp_ledger              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships            ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows                ENABLE ROW LEVEL SECURITY;
ALTER TABLE guilds                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_wars             ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages               ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_chats            ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_chat_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_quests            ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons                ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_passes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE nemesis_assignments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports                ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_earnings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_payouts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE gifts                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_modals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_banners   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_modal_views       ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_message_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE x_manifest             ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_login_states  ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_commissions   ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_public ON users FOR SELECT USING (true);
CREATE POLICY users_update_own    ON users FOR UPDATE
  USING (id::text = current_setting('app.current_user_id', true));

CREATE POLICY coin_ledger_select_own ON coin_ledger FOR SELECT
  USING (user_id::text = current_setting('app.current_user_id', true));
CREATE POLICY coin_ledger_insert_service ON coin_ledger FOR INSERT WITH CHECK (true);

CREATE POLICY star_ledger_select_own ON star_ledger FOR SELECT
  USING (user_id::text = current_setting('app.current_user_id', true));
CREATE POLICY star_ledger_insert_service ON star_ledger FOR INSERT WITH CHECK (true);

CREATE POLICY xp_ledger_select_own ON xp_ledger FOR SELECT
  USING (user_id::text = current_setting('app.current_user_id', true));
CREATE POLICY xp_ledger_insert_service ON xp_ledger FOR INSERT WITH CHECK (true);

CREATE POLICY sessions_own ON sessions FOR ALL
  USING (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY friendships_own ON friendships FOR SELECT USING (
  requester_id::text = current_setting('app.current_user_id', true) OR
  addressee_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY friendships_insert ON friendships FOR INSERT WITH CHECK (
  requester_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY friendships_update_own ON friendships FOR UPDATE USING (
  requester_id::text = current_setting('app.current_user_id', true) OR
  addressee_id::text = current_setting('app.current_user_id', true)
);

CREATE POLICY follows_select ON follows FOR SELECT USING (true);
CREATE POLICY follows_insert ON follows FOR INSERT WITH CHECK (
  follower_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY follows_delete ON follows FOR DELETE USING (
  follower_id::text = current_setting('app.current_user_id', true)
);

CREATE POLICY guilds_select ON guilds FOR SELECT USING (true);
CREATE POLICY guilds_insert ON guilds FOR INSERT WITH CHECK (
  captain_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY guilds_update_captain ON guilds FOR UPDATE USING (
  captain_id::text = current_setting('app.current_user_id', true)
);

CREATE POLICY guild_members_select ON guild_members FOR SELECT USING (
  user_id::text = current_setting('app.current_user_id', true) OR
  guild_id IN (
    SELECT guild_id FROM guild_members
    WHERE user_id::text = current_setting('app.current_user_id', true)
  )
);
CREATE POLICY guild_members_insert_service ON guild_members FOR INSERT WITH CHECK (true);
CREATE POLICY guild_members_update_service ON guild_members FOR UPDATE USING (true);
CREATE POLICY guild_members_delete_service ON guild_members FOR DELETE USING (true);

CREATE POLICY guild_wars_select          ON guild_wars FOR SELECT USING (true);
CREATE POLICY guild_wars_insert_service  ON guild_wars FOR INSERT WITH CHECK (true);
CREATE POLICY guild_wars_update_service  ON guild_wars FOR UPDATE USING (true);

CREATE POLICY rooms_select ON rooms FOR SELECT USING (
  is_public = true OR
  creator_id::text = current_setting('app.current_user_id', true) OR
  id IN (SELECT room_id FROM room_members
         WHERE user_id::text = current_setting('app.current_user_id', true))
);
CREATE POLICY rooms_insert ON rooms FOR INSERT WITH CHECK (
  creator_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY rooms_update_creator ON rooms FOR UPDATE USING (
  creator_id::text = current_setting('app.current_user_id', true)
);

CREATE POLICY room_members_select ON room_members FOR SELECT USING (
  room_id IN (SELECT room_id FROM room_members
              WHERE user_id::text = current_setting('app.current_user_id', true))
);
CREATE POLICY room_members_insert_service ON room_members FOR INSERT WITH CHECK (true);

CREATE POLICY group_chats_select ON group_chats FOR SELECT USING (
  id IN (SELECT group_chat_id FROM group_chat_members
         WHERE user_id::text = current_setting('app.current_user_id', true))
);
CREATE POLICY group_chats_insert ON group_chats FOR INSERT WITH CHECK (
  creator_id::text = current_setting('app.current_user_id', true)
);

CREATE POLICY group_chat_members_select ON group_chat_members FOR SELECT USING (
  group_chat_id IN (SELECT group_chat_id FROM group_chat_members
                    WHERE user_id::text = current_setting('app.current_user_id', true))
);
CREATE POLICY group_chat_members_insert_service ON group_chat_members FOR INSERT WITH CHECK (true);

CREATE POLICY messages_dm_select ON messages FOR SELECT USING (
  sender_id::text = current_setting('app.current_user_id', true) OR
  recipient_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY messages_insert ON messages FOR INSERT WITH CHECK (
  sender_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY messages_update_own ON messages FOR UPDATE USING (
  sender_id::text = current_setting('app.current_user_id', true)
);

CREATE POLICY room_messages_select ON room_messages FOR SELECT USING (
  room_id IN (SELECT id FROM rooms WHERE is_public = true)
  OR room_id IN (SELECT room_id FROM room_members
                 WHERE user_id::text = current_setting('app.current_user_id', true))
  OR sender_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY room_messages_insert ON room_messages FOR INSERT WITH CHECK (
  sender_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY room_messages_update_own ON room_messages FOR UPDATE USING (
  sender_id::text = current_setting('app.current_user_id', true)
);

CREATE POLICY message_reactions_select ON message_reactions FOR SELECT USING (true);
CREATE POLICY message_reactions_insert ON message_reactions FOR INSERT WITH CHECK (
  user_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY message_reactions_delete ON message_reactions FOR DELETE USING (
  user_id::text = current_setting('app.current_user_id', true)
);

CREATE POLICY quests_own ON user_quests FOR ALL USING (
  user_id::text = current_setting('app.current_user_id', true)
);

CREATE POLICY seasons_select ON seasons FOR SELECT USING (true);

CREATE POLICY season_passes_own ON season_passes FOR SELECT USING (
  user_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY season_passes_insert_service ON season_passes FOR INSERT WITH CHECK (true);

CREATE POLICY nemesis_own ON nemesis_assignments FOR SELECT USING (
  user_id::text = current_setting('app.current_user_id', true)
);

CREATE POLICY reports_insert ON reports FOR INSERT WITH CHECK (
  reporter_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY reports_select_own ON reports FOR SELECT USING (
  reporter_id::text = current_setting('app.current_user_id', true)
);

CREATE POLICY payments_own ON payments FOR SELECT USING (
  user_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY payments_insert_service ON payments FOR INSERT WITH CHECK (true);
CREATE POLICY payments_update_service ON payments FOR UPDATE USING (true);

CREATE POLICY earnings_own ON creator_earnings FOR SELECT USING (
  creator_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY earnings_insert_service ON creator_earnings FOR INSERT WITH CHECK (true);

CREATE POLICY payouts_own ON creator_payouts FOR SELECT USING (
  creator_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY payouts_insert_own ON creator_payouts FOR INSERT WITH CHECK (
  creator_id::text = current_setting('app.current_user_id', true)
);

CREATE POLICY gift_items_select ON gift_items FOR SELECT USING (true);

CREATE POLICY gifts_own ON gifts FOR SELECT USING (
  sender_id::text = current_setting('app.current_user_id', true) OR
  recipient_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY gifts_insert_service ON gifts FOR INSERT WITH CHECK (true);

CREATE POLICY modals_select  ON announcement_modals   FOR SELECT USING (true);
CREATE POLICY banners_select ON announcement_banners  FOR SELECT USING (true);

CREATE POLICY modal_views_own ON user_modal_views FOR ALL USING (
  user_id::text = current_setting('app.current_user_id', true)
);

CREATE POLICY admin_messages_insert_service ON admin_messages FOR INSERT WITH CHECK (true);

CREATE POLICY admin_msg_receipts_own ON admin_message_receipts FOR SELECT USING (
  user_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY admin_msg_receipts_update_own ON admin_message_receipts FOR UPDATE USING (
  user_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY admin_msg_receipts_insert_service ON admin_message_receipts FOR INSERT WITH CHECK (true);

CREATE POLICY subscriptions_own ON subscriptions FOR SELECT USING (
  user_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY subscriptions_insert_service ON subscriptions FOR INSERT WITH CHECK (true);
CREATE POLICY subscriptions_update_service ON subscriptions FOR UPDATE USING (true);

CREATE POLICY referrals_own ON referrals FOR SELECT USING (
  referrer_id::text = current_setting('app.current_user_id', true) OR
  referred_id::text = current_setting('app.current_user_id', true)
);
CREATE POLICY referrals_insert_service ON referrals FOR INSERT WITH CHECK (true);
CREATE POLICY referrals_update_service ON referrals FOR UPDATE USING (true);

CREATE POLICY manifest_select ON x_manifest FOR SELECT USING (true);

CREATE POLICY telegram_login_states_service_only ON telegram_login_states
  USING (false) WITH CHECK (false);

CREATE POLICY referral_commissions_owner ON referral_commissions FOR SELECT USING (
  referrer_id::text = current_setting('app.user_id', true)
);


-- ============================================================
-- SECTION 15: Seed Data
-- ============================================================

-- x_manifest (final merged set — canonical keys only)
INSERT INTO x_manifest (key, value, description) VALUES
  ('minimum_age',                          '18',                       'Minimum age for registration'),
  ('captcha_provider',                     '"none"',                   'CAPTCHA provider: recaptcha | turnstile | none'),
  ('auth_google_enabled',                  'true',                     'Enable Google OAuth'),
  ('auth_telegram_enabled',                'true',                     'Enable Telegram Login'),
  ('feature_nemesis_system',               'true',                     'Enable Nemesis system'),
  ('feature_guild_wars',                   'true',                     'Enable Guild Wars'),
  ('feature_classrooms',                   'true',                     'Enable ClassRooms'),
  ('feature_community_notes',              'true',                     'Enable Community Notes'),
  ('feature_star_purchase',                'false',                    'Enable direct Star purchase'),
  ('feature_star_purchase_enabled',        'false',                    'Enable direct Star purchase via store'),
  ('feature_merch_store',                  'false',                    'Enable Creator Merch Store'),
  ('feature_platform_council',             'true',                     'Enable Platform Council'),
  ('feature_alliance_system',              'true',                     'Enable Alliance System'),
  ('feature_business_accounts',            'true',                     'Enable Business Accounts'),
  ('feature_admob_ads',                    'true',                     'Enable AdMob ads'),
  ('feature_rewarded_ads',                 'true',                     'Enable rewarded video ads'),
  ('feature_rooms',                        'true',                     'Enable Rooms feature'),
  ('feature_direct_messages',             'true',                     'Enable Direct Messages'),
  ('feature_gifts',                        'true',                     'Enable Gifts feature'),
  ('feature_rankings',                     'true',                     'Enable Rankings/Leaderboards'),
  ('feature_pin_auth',                     'true',                     'Enable PIN authentication'),
  ('feature_mystery_xp_drops',            'true',                     'Enable Mystery XP Drop events'),
  ('mystery_drop_batch_size',             '50',                       'Users per Mystery XP Drop'),
  ('mystery_drop_days_per_week',          '3',                        'Mystery drop days per week'),
  ('pwa_web_enabled',                     'true',                     'Enable PWA on web'),
  ('pwa_android_enabled',                 'false',                    'Enable PWA on Android'),
  ('pwa_ios_enabled',                     'false',                    'Enable PWA on iOS'),
  ('payment_provider_nigeria',            '"paystack"',               'Payment provider Nigeria'),
  ('payment_provider_international',      '"dodopayments"',           'Payment provider international'),
  ('payout_provider_nigeria',             '"paystack"',               'Payout provider Nigeria'),
  ('payout_provider_international',       '"dodopayments"',           'Payout provider international'),
  ('coin_to_cash_rate',                   '1',                        'Kobo per coin (1 coin = 1 kobo = ₦0.01)'),
  ('payout_threshold_kobo',               '100000',                   'Minimum payout in kobo (₦1,000)'),
  ('payout_large_approval_kobo',          '5000000',                  'Manual approval threshold kobo (₦50,000)'),
  ('payout_low_balance_alert_kobo',       '10000000',                 'Low balance alert kobo (₦100,000)'),
  ('vip_room_min_subscription_kobo',      '20000',                    'Min VIP Room subscription (₦200)'),
  ('vip_room_max_subscription_kobo',      '1000000',                  'Max VIP Room subscription (₦10,000)'),
  ('season_pass_price_coins',             '500',                      'Default Season Pass price in Coins'),
  ('creator_platform_fee_percent',        '20',                       'Platform fee % on creator earnings'),
  ('dm_coin_cost_free',                   '2',                        'DM coin cost Free tier'),
  ('dm_coin_cost_plus',                   '1',                        'DM coin cost Plus tier'),
  ('dm_reply_limit_free',                 '25',                       'Max DM replies/day Free plan'),
  ('dm_reply_limit_plus',                 '50',                       'Max DM replies/day Plus plan'),
  ('email_all_enabled',                   'true',                     'Enable all email notifications'),
  ('email_non_critical_enabled',          'true',                     'Enable non-critical emails'),
  ('announcement_modal_display_mode',     '"serial"',                 'Modal display: serial or random'),
  ('announcement_banner_mode',            '"serial"',                 'Banner display: serial or random'),
  ('deep_link_base_url',                  '"https://zobia.social"',   'Base URL for deep links'),
  ('admob_app_id',                        '""',                       'AdMob App ID'),
  ('admob_banner_unit_id',               '""',                       'AdMob Banner Ad Unit ID'),
  ('admob_interstitial_unit_id',         '""',                       'AdMob Interstitial Ad Unit ID'),
  ('admob_rewarded_unit_id',             '""',                       'AdMob Rewarded Ad Unit ID'),
  ('gif_provider',                        '"giphy"',                  'GIF provider: giphy or tenor'),
  ('cron_external_enabled',              'false',                    'Use cron-jobs.org for high-frequency crons'),
  ('ai_moderation_enabled',              'true',                     'Enable AI moderation'),
  ('ai_moderation_auto_action_threshold','0.9',                      'AI auto-action confidence threshold'),
  ('ai_moderation_community_threshold',  '0.7',                      'AI community review threshold'),
  ('ai_moderation_system_prompt',        '""',                       'Override AI moderation system prompt'),
  ('payouts_enabled',                    'true',                     'Master payout toggle'),
  ('nigeria_cash_payout_enabled',        'true',                     'Nigeria bank transfer payouts'),
  ('nigeria_coins_payout_enabled',       'true',                     'Nigeria coin-based payouts'),
  ('nigeria_crypto_payout_enabled',      'true',                     'Nigeria USDT/Tron payouts'),
  ('global_coins_payout_enabled',        'true',                     'Global coin-based payouts'),
  ('global_crypto_payout_enabled',       'true',                     'Global USDT/Tron payouts'),
  ('nigeria_payout_auto_approve',        'true',                     'Nigeria bank auto-approve'),
  ('payout_batch_size',                  '200',                      'Max payouts per CRON run'),
  ('payout_max_retries',                 '3',                        'Max payout retry attempts'),
  ('bank_account_first_add_xp',          '5',                        'XP on first bank account add'),
  ('bank_account_first_add_creator_xp',  '10',                       'Creator XP on first bank account add'),
  ('referral_tier1_coin_bonus',          '100',                      'Tier 1 referral coin bonus'),
  ('referral_tier1_xp_bonus',            '500',                      'Tier 1 referral XP bonus'),
  ('referral_tier2_coin_bonus',          '50',                       'Tier 2 referral coin bonus'),
  ('referral_tier2_xp_bonus',            '250',                      'Tier 2 referral XP bonus'),
  ('referral_qualifying_action',         '"coin_purchase"',          'Action that qualifies a referral'),

  -- 2FA (migration 007)
  ('auth_2fa_enabled',           'true',  'Allow users to configure two-factor authentication'),
  ('auth_2fa_required_for_mods', 'false', 'Require 2FA for moderators before they can log in'),

  -- Profile privacy (migration 008)
  ('privacy_can_lock_profile',
   '["pro","max","prestige_1"]',
   'Plans/roles allowed to lock their profile (hide from non-friends). JSON array.'),
  ('privacy_can_hide_sections',
   '["plus","pro","max","prestige_1"]',
   'Plans/roles allowed to hide individual profile sections. JSON array.'),
  ('privacy_can_disable_friend_requests',
   '["plus","pro","max","prestige_1"]',
   'Plans/roles allowed to disable incoming friend requests. JSON array.'),
  ('privacy_hideable_sections',
   '["avatar","bio","rank","xp","guild","seasons","badges"]',
   'Profile sections that users can hide (admin-controlled list). JSON array.'),

  -- Currency display names (migration 009)
  ('currency_soft_name_singular',    '"Credit"',  'Singular display name for the earned soft currency (e.g. Credit)'),
  ('currency_soft_name_plural',      '"Credits"', 'Plural display name for the earned soft currency (e.g. Credits)'),
  ('currency_premium_name_singular', '"Star"',    'Singular display name for the purchased premium currency (e.g. Star)'),
  ('currency_premium_name_plural',   '"Stars"',   'Plural display name for the purchased premium currency (e.g. Stars)')
ON CONFLICT (key) DO NOTHING;

-- subscription_plans
INSERT INTO subscription_plans (plan, name, interval, price_kobo, currency, is_active, sort_order) VALUES
  ('plus', 'Plus — Monthly',  'monthly',    50000, 'NGN', true, 10),
  ('pro',  'Pro — Monthly',   'monthly',   150000, 'NGN', true, 20),
  ('max',  'Max — Monthly',   'monthly',   350000, 'NGN', true, 30),
  ('plus', 'Plus — Annual',   'annual',    500000, 'NGN', true, 11),
  ('pro',  'Pro — Annual',    'annual',   1500000, 'NGN', true, 21),
  ('max',  'Max — Annual',    'annual',   3500000, 'NGN', true, 31)
ON CONFLICT (plan, interval) DO NOTHING;

-- quest_templates (using final column names: action_type, target_count, plan_required)
INSERT INTO quest_templates (title, description, action_type, target_count, xp_reward, coin_reward, track, plan_required, category, icon) VALUES
  ('Message Marathon',  'Send 10 messages today',                  'messages',     10,  100, 10, 'social',     'free', 'social',     '💬'),
  ('Room Explorer',     'Join a Room you haven''t visited before', 'room_join',     1,  150,  0, 'explorer',   'free', 'explorer',   '🚪'),
  ('Be Generous',       'Gift any user today',                     'gift',          1,   50,  5, 'generosity', 'free', 'generosity', '🎁'),
  ('Streak Keeper',     'Log in for 7 consecutive days',           'login_streak',  7,  200, 50, 'main',       'free', 'general',    '⭐'),
  ('Guild Quest',       'Complete a Guild Quest contribution',      'guild_quest',   1,  200,  0, 'competitor', 'free', 'general',    '⭐'),
  ('XP Grinder',        'Earn 500 XP today',                       'xp_meta',     500,  100, 20, 'main',       'free', 'general',    '⭐'),
  ('Social Butterfly',  'Send 25 messages today',                  'messages',     25,  200, 20, 'social',     'plus', 'social',     '💬'),
  ('Room Master',       'Visit 3 different Rooms today',           'room_join',     3,  300, 30, 'explorer',   'pro',  'explorer',   '🚪'),
  ('Super Gifter',      'Send 3 gifts today',                      'gift',          3,  150, 15, 'generosity', 'pro',  'generosity', '🎁'),
  ('XP Champion',       'Earn 2000 XP today',                      'xp_meta',    2000,  300, 50, 'main',       'max',  'general',    '⭐')
ON CONFLICT DO NOTHING;

-- gift_items
INSERT INTO gift_items (name, emoji, coin_price, coin_cost, tier, spectacle_threshold_coins) VALUES
  ('Flower',          '🌸',   5,    5,   1, NULL),
  ('Cold One',        '🍺',  10,   10,   1, NULL),
  ('Respect',         '🤝',  15,   15,   1, NULL),
  ('Fire',            '🔥',  25,   25,   1, NULL),
  ('Big Brain',       '🧠',  40,   40,   1, NULL),
  ('Trophy',          '🏆',  80,   80,   2, 150),
  ('Diamond',         '💎', 150,  150,   2, 150),
  ('Crown',           '👑', 300,  300,   2, 150),
  ('Rocket',          '🚀', 400,  400,   2, 150),
  ('Lion',            '🦁', 500,  500,   2, 150),
  ('Money Bag',       '💰', 800,  800,   3, 800),
  ('City Night',      '🌃',1500, 1500,   3, 800),
  ('Stadium Roar',    '🏟️',2000, 2000,   3, 800),
  ('Legendary Crown', '✨',5000, 5000,   3, 800)
ON CONFLICT DO NOTHING;

-- store_items: coin packs (PRD-spec prices)
INSERT INTO store_items (name, item_type, price_kobo, currency, coins_granted, bonus_label, is_featured, sort_order) VALUES
  ('Starter Pack', 'coin_pack',   20000, 'NGN',   100, NULL,           false, 1),
  ('Regular Pack', 'coin_pack',   50000, 'NGN',   350, NULL,           false, 2),
  ('Big Pack',     'coin_pack',  100000, 'NGN',   800, '+14% BONUS',   true,  3),
  ('Baller Pack',  'coin_pack',  200000, 'NGN',  1800, '+29% BONUS',   false, 4),
  ('Boss Pack',    'coin_pack',  500000, 'NGN',  5000, '+67% BONUS',   false, 5),
  ('Legend Pack',  'coin_pack', 1000000, 'NGN', 11500, '+92% BONUS',   false, 6)
ON CONFLICT DO NOTHING;

-- store_items: star packs
INSERT INTO store_items (name, item_type, price_kobo, currency, stars_granted, bonus_label, is_featured, sort_order) VALUES
  ('Starter Stars', 'star_pack',  200000, 'NGN',   5, NULL,           false, 1),
  ('Rising Stars',  'star_pack',  500000, 'NGN',  15, '+20% BONUS',   true,  2),
  ('Star Bundle',   'star_pack', 1000000, 'NGN',  35, '+40% BONUS',   false, 3),
  ('Mega Stars',    'star_pack', 2500000, 'NGN', 100, '+67% BONUS',   false, 4)
ON CONFLICT DO NOTHING;

-- store_items: cosmetics
INSERT INTO store_items (name, description, item_type, cosmetic_type, stars_cost, is_exclusive, is_featured, sort_order) VALUES
  ('Prestige Flame Frame',  'Animated flame frame for Prestige users.',         'cosmetic', 'profile_frame',  5,  true,  true,  10),
  ('Golden Galaxy Frame',   'Rare animated gold particles around the avatar.',  'cosmetic', 'profile_frame',  10, true,  false, 11),
  ('Phoenix Wings Border',  'Animated phoenix wings for Prestige holders.',     'cosmetic', 'profile_frame',  15, true,  false, 12),
  ('Diamond Glow Border',   'Pulsing diamond border animation.',                'cosmetic', 'avatar_border',   3, false, true,  20),
  ('Neon Lagos Border',     'Neon-lit Lagos skyline avatar border.',            'cosmetic', 'avatar_border',   5, false, false, 21),
  ('First in the City',     'Display "First in the City" beneath your name.',  'cosmetic', 'title',           8, true,  false, 30),
  ('War Machine',           'Title for winning 10 Guild Wars.',                'cosmetic', 'title',          12, true,  false, 31),
  ('The Patron',            'Top Gifter in 3+ Rooms — exclusive title.',       'cosmetic', 'title',          10, true,  false, 32),
  ('Zobia Confetti Burst',  'Animated confetti when you send a message.',       'cosmetic', 'animated_item',   2, false, true,  40),
  ('Gold Coin Rain',        'Gold coin shower on profile card.',                'cosmetic', 'animated_item',   7, false, false, 41)
ON CONFLICT DO NOTHING;

-- store_items: boosters
INSERT INTO store_items (name, description, item_type, coins_cost, is_active, is_featured, sort_order, metadata) VALUES
  ('Premium Send',           'Premium animation on your next message.',      'booster', 50,  true, false, 90,
   '{"subtype":"premium_send","duration_type":"one_shot","animation":"gold_shimmer"}'),
  ('Premium Send — 7 Day Pass', 'Premium Send for 7 days.',                  'booster', 250, true, false, 91,
   '{"subtype":"premium_send","duration_type":"subscription","duration_days":7,"animation":"gold_shimmer"}')
ON CONFLICT DO NOTHING;

-- sticker_packs
INSERT INTO sticker_packs (name, description, cover_emoji, pack_type, coin_price) VALUES
  ('Naija Vibes',  'Nigerian cultural expressions', '🇳🇬', 'free',    0),
  ('Flex Pack',    'Show off your style',           '💎', 'earnable', 0),
  ('Boss Moves',   'Premium reactions',             '👑', 'premium', 150)
ON CONFLICT DO NOTHING;

INSERT INTO sticker_packs (name, description, cover_emoji, pack_type, coin_price, locale) VALUES
  ('Naija Hausa',   'Northern Nigerian Hausa expressions', '🇳🇬', 'free', 0, 'ha'),
  ('Yoruba Vibes',  'Yoruba cultural stickers',            '🌟', 'free', 0, 'yo'),
  ('Igbo Pride',    'Igbo expressions and culture',        '🦁', 'free', 0, 'ig'),
  ('Swahili Soul',  'East African Swahili stickers',       '🌍', 'free', 0, 'sw'),
  ('Arabic Flow',   'Arabic language expressions',         '✨', 'free', 0, 'ar'),
  ('French Touch',  'Francophone African stickers',        '🎭', 'free', 0, 'fr'),
  ('Lusophone',     'Portuguese-speaking African stickers','🌊', 'free', 0, 'pt')
ON CONFLICT DO NOTHING;

INSERT INTO sticker_packs (name, description, cover_emoji, pack_type, coin_price, unlock_condition) VALUES
  ('Social Butterfly', 'Unlock at Social Level 5',  '🦋', 'earnable', 0, 'Reach Social Level 5'),
  ('Connector',        'Unlock at Social Level 10', '🔗', 'earnable', 0, 'Reach Social Level 10'),
  ('Influencer Pack',  'Unlock at Social Level 20', '💫', 'earnable', 0, 'Reach Social Level 20'),
  ('Legend Pack',      'Unlock at Social Level 30', '🏆', 'earnable', 0, 'Reach Social Level 30'),
  ('Prestige Pack',    'Unlock on first Prestige',  '👑', 'earnable', 0, 'Achieve Prestige I')
ON CONFLICT DO NOTHING;

INSERT INTO sticker_packs (name, description, cover_emoji, pack_type, coin_price) VALUES
  ('Elite Reactions', 'Premium high-energy reactions', '⚡', 'premium', 100),
  ('Luxury Flex',     'Show your premium status',      '💎', 'premium', 250),
  ('Zobia Exclusive', 'Ultra-rare exclusive stickers', '🌌', 'premium', 500)
ON CONFLICT DO NOTHING;

-- Naija Vibes sticker items
INSERT INTO stickers (pack_id, name, emoji, position)
SELECT sp.id, 'Naija Pride',              '🇳🇬', 1 FROM sticker_packs sp WHERE sp.name = 'Naija Vibes' ON CONFLICT DO NOTHING;
INSERT INTO stickers (pack_id, name, emoji, position)
SELECT sp.id, 'Oya Now',                  '😤', 2 FROM sticker_packs sp WHERE sp.name = 'Naija Vibes' ON CONFLICT DO NOTHING;
INSERT INTO stickers (pack_id, name, emoji, position)
SELECT sp.id, 'No Cap',                   '🙅', 3 FROM sticker_packs sp WHERE sp.name = 'Naija Vibes' ON CONFLICT DO NOTHING;
INSERT INTO stickers (pack_id, name, emoji, position)
SELECT sp.id, 'Sapa Mode',                '😭', 4 FROM sticker_packs sp WHERE sp.name = 'Naija Vibes' ON CONFLICT DO NOTHING;
INSERT INTO stickers (pack_id, name, emoji, position)
SELECT sp.id, 'God Don Butter My Bread',  '🙏', 5 FROM sticker_packs sp WHERE sp.name = 'Naija Vibes' ON CONFLICT DO NOTHING;

-- cron_state seed
INSERT INTO cron_state (key, value_ts, updated_at)
VALUES ('next_mystery_drop_at', NOW() + INTERVAL '3 days', NOW())
ON CONFLICT (key) DO NOTHING;

-- Cultural events (complete calendar)
INSERT INTO platform_events (name, description, event_type, xp_multiplier, starts_at, ends_at, is_recurring_annual,
  recurrence_anchor_month_start, recurrence_anchor_day_start, recurrence_anchor_month_end, recurrence_anchor_day_end, metadata) VALUES
  ('Nigerian Independence Day Double XP', 'Full-platform double XP on Oct 1st', 'cultural', 2.0,
   '2025-10-01 00:00:00+00', '2025-10-01 23:59:59+00', true, 10, 1, 10, 1, '{"city_filter":null}'),
  ('Detty December Season', 'The biggest season of the year', 'cultural', 1.5,
   '2025-12-01 00:00:00+00', '2025-12-31 23:59:59+00', true, 12, 1, 12, 31, '{"city_filter":null}'),
  ('Valentine Gift Weekend', 'Double XP for gifts sent', 'cultural', 1.0,
   '2026-02-13 00:00:00+00', '2026-02-15 23:59:59+00', true, 2, 13, 2, 15, '{"gift_xp_multiplier":2}'),
  ('Easter Celebration Weekend', 'Double gift XP across the platform', 'cultural', 1.0,
   '2026-04-03 00:00:00+00', '2026-04-05 23:59:59+00', true, 4, 3, 4, 5, '{"gift_xp_multiplier":2}'),
  ('Africa Freedom Day', 'Pan-African double XP on May 25th', 'cultural', 2.0,
   '2026-05-25 00:00:00+00', '2026-05-25 23:59:59+00', true, 5, 25, 5, 25, '{"city_filter":null}'),
  ('Labour Day Boost', '1.5x XP on International Workers Day', 'cultural', 1.5,
   '2026-05-01 00:00:00+00', '2026-05-01 23:59:59+00', true, 5, 1, 5, 1, '{"city_filter":null}'),
  ('African Union Day', 'Cross-continent guild alliance bonus weekend', 'cultural', 1.5,
   '2026-07-10 00:00:00+00', '2026-07-12 23:59:59+00', true, 7, 10, 7, 12, '{"alliance_bonus":true}'),
  ('Eid al-Adha Celebration', 'Double gifting XP during the feast', 'cultural', 1.0,
   '2026-06-06 00:00:00+00', '2026-06-08 23:59:59+00', true, 6, 6, 6, 8, '{"gift_xp_multiplier":2}'),
  ('Eid al-Fitr Celebration', 'Community gifting bonus at end of Ramadan', 'cultural', 1.0,
   '2026-03-30 00:00:00+00', '2026-03-31 23:59:59+00', true, 3, 30, 3, 31, '{"gift_xp_multiplier":2}'),
  ('Black History Month', 'All-February 1.25x XP', 'cultural', 1.25,
   '2026-02-01 00:00:00+00', '2026-02-28 23:59:59+00', true, 2, 1, 2, 28, '{"city_filter":null}'),
  ('Kwanzaa Week', 'Community and culture XP boost Dec 26-Jan 1', 'cultural', 1.5,
   '2026-12-26 00:00:00+00', '2027-01-01 23:59:59+00', true, 12, 26, 1, 1, '{"city_filter":null}'),
  ('New Year Countdown', 'Triple XP in the final hour of the year', 'cultural', 3.0,
   '2026-12-31 23:00:00+00', '2027-01-01 00:59:59+00', true, 12, 31, 1, 1, '{"city_filter":null}'),
  ('New Year Hustle Season', 'Bonus XP for the first week of the year', 'cultural', 1.5,
   '2026-01-01 01:00:00+00', '2026-01-07 23:59:59+00', true, 1, 1, 1, 7, '{"city_filter":null,"badge":"new_year_hustle_2026"}'),
  ('AFCON Season', 'Africa Cup of Nations — 1.5x competitor XP', 'cultural', 1.5,
   '2026-01-10 00:00:00+00', '2026-02-28 23:59:59+00', false, null, null, null, null,
   '{"tracks":["competitor"],"guild_war_points_multiplier":1.5}'),
  ('International Women''s Month — Creator Boost Week', 'Female creators earn 1.5x XP in first week of March', 'cultural', 1.5,
   '2026-03-01 00:00:00+00', '2026-03-07 23:59:59+00', true, 3, 1, 3, 7,
   '{"female_creator_only":true,"boost_tracks":["creator","social"]}')
ON CONFLICT DO NOTHING;

