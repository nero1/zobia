-- ============================================================
-- Zobia Social — Migration 001: Initial Schema
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- x_manifest — Platform config / feature flags
-- Read at runtime by the application and admin panel.
-- All values are JSONB so numbers, booleans, and strings
-- can all be stored without a schema change.
-- ============================================================
CREATE TABLE x_manifest (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO x_manifest (key, value, description) VALUES
('minimum_age',                          '18',                  'Minimum age for registration'),
('captcha_provider',                     '"recaptcha"',         'CAPTCHA provider: recaptcha or turnstile'),
('auth_google_enabled',                  'true',                'Enable Google OAuth'),
('auth_telegram_enabled',                'true',                'Enable Telegram Login'),
('feature_nemesis',                      'true',                'Enable Nemesis system'),
('feature_guild_wars',                   'true',                'Enable Guild Wars'),
('feature_classrooms',                   'true',                'Enable ClassRooms'),
('feature_community_notes',              'false',               'Enable Community Notes'),
('feature_star_direct_purchase',         'false',               'Enable direct Star purchase'),
('feature_creator_merch',                'false',               'Enable Creator Merch Store'),
('feature_platform_council',             'false',               'Enable Platform Council'),
('feature_alliance_system',              'false',               'Enable Alliance System'),
('feature_business_accounts',            'false',               'Enable Business Accounts'),
('feature_admob_ads',                    'false',               'Enable AdMob ads'),
('feature_rewarded_ads',                 'false',               'Enable rewarded video ads'),
('pwa_web_enabled',                      'true',                'Enable PWA on web'),
('pwa_android_enabled',                  'false',               'Enable PWA on Android'),
('pwa_ios_enabled',                      'false',               'Enable PWA on iOS'),
('payment_provider_nigeria',             '"paystack"',          'Payment provider for Nigeria web/PWA'),
('payment_provider_international',       '"dodopayments"',      'Payment provider for international'),
('payout_provider_nigeria',              '"paystack"',          'Payout provider for Nigeria'),
('payout_provider_international',        '"dodopayments"',      'Payout provider for international'),
('coin_to_cash_rate',                    '0.01',                'Coin to NGN rate (1 coin = 0.01 NGN)'),
('payout_threshold_kobo',                '100000',              'Minimum payout amount in kobo (₦1,000)'),
('payout_manual_approval_threshold_kobo','5000000',             'Manual approval threshold in kobo (₦50,000)'),
('payout_low_balance_alert_kobo',        '10000000',            'Low balance alert threshold (₦100,000)'),
('vip_room_min_subscription_kobo',       '20000',               'Min VIP Room subscription (₦200)'),
('vip_room_max_subscription_kobo',       '1000000',             'Max VIP Room subscription (₦10,000)'),
('season_pass_price_coins',              '500',                 'Default Season Pass price in Coins'),
('creator_platform_fee_percent',         '20',                  'Platform fee % on creator earnings'),
('dm_coin_cost_free',                    '2',                   'Coins to reply to DM (Free tier)'),
('dm_coin_cost_plus',                    '1',                   'Coins to reply to DM (Plus tier)'),
('email_all_enabled',                    'true',                'Enable all email notifications'),
('email_non_critical_enabled',           'true',                'Enable non-critical emails'),
('announcement_modal_display_mode',      '"serial"',            'Modal display: serial or random'),
('announcement_banner_display_mode',     '"serial"',            'Banner display: serial or random'),
('deep_link_base_url',                   '"https://zobia.social"', 'Base URL for deep links'),
('admob_app_id',                         '""',                  'AdMob App ID'),
('admob_banner_unit_id',                 '""',                  'AdMob Banner Ad Unit ID'),
('admob_interstitial_unit_id',           '""',                  'AdMob Interstitial Ad Unit ID'),
('admob_rewarded_unit_id',               '""',                  'AdMob Rewarded Video Ad Unit ID'),
('gif_provider',                         '"giphy"',             'GIF provider: giphy or tenor'),
('cron_external_enabled',                'false',               'Use cron-jobs.org for high-frequency crons'),
('ai_moderation_enabled',                'true',                'Enable AI moderation');

-- ============================================================
-- users
-- Central identity record. One row per person.
-- ============================================================
CREATE TABLE users (
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

  -- Auth
  google_id        TEXT UNIQUE,
  telegram_id      TEXT UNIQUE,
  is_email_verified BOOLEAN DEFAULT false,
  two_fa_secret    TEXT,
  two_fa_enabled   BOOLEAN DEFAULT false,

  -- Status
  plan         TEXT NOT NULL DEFAULT 'free'
                 CHECK (plan IN ('free', 'plus', 'pro', 'max')),
  is_admin     BOOLEAN NOT NULL DEFAULT false,
  is_moderator BOOLEAN NOT NULL DEFAULT false,
  is_creator   BOOLEAN NOT NULL DEFAULT false,
  creator_tier TEXT DEFAULT 'rookie'
                 CHECK (creator_tier IN ('rookie', 'rising', 'verified', 'elite', 'icon')),
  is_verified  BOOLEAN DEFAULT false,

  -- Trust & Safety
  trust_score       INTEGER DEFAULT 50 CHECK (trust_score BETWEEN 0 AND 100),
  is_suspended      BOOLEAN DEFAULT false,
  suspended_until   TIMESTAMPTZ,
  suspension_reason TEXT,
  is_banned         BOOLEAN DEFAULT false,
  ban_type          TEXT CHECK (ban_type IN ('temporary', 'permanent')),
  banned_until      TIMESTAMPTZ,
  ban_reason        TEXT,

  -- XP & Rank (main track)
  xp_total       INTEGER NOT NULL DEFAULT 0,
  legacy_score   INTEGER NOT NULL DEFAULT 0,
  rank_name      TEXT    NOT NULL DEFAULT 'Beginner',
  rank_level     INTEGER NOT NULL DEFAULT 1,
  rank_sublevel  INTEGER NOT NULL DEFAULT 1, -- 1=I, 2=II, 3=III
  prestige_count INTEGER NOT NULL DEFAULT 0,

  -- Track XP (six parallel tracks)
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
  coin_balance BIGINT  NOT NULL DEFAULT 0,
  star_balance INTEGER NOT NULL DEFAULT 0,

  -- Streaks
  login_streak    INTEGER NOT NULL DEFAULT 0,
  longest_streak  INTEGER NOT NULL DEFAULT 0,
  last_login_at   TIMESTAMPTZ,
  last_active_at  TIMESTAMPTZ DEFAULT NOW(),

  -- Metadata
  date_of_birth           DATE,
  vibe_quiz_responses     JSONB,
  onboarding_completed    BOOLEAN DEFAULT false,
  new_member_quest_completed BOOLEAN DEFAULT false,

  -- Referral
  referred_by_user_id UUID REFERENCES users(id),
  referral_code       TEXT UNIQUE,

  -- Push / notification preferences
  push_token           TEXT,
  dm_notifications     BOOLEAN DEFAULT true,
  guild_notifications  BOOLEAN DEFAULT true,
  streak_notifications BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- coin_ledger — immutable, append-only financial log
-- balance_before + amount = balance_after (always verified
-- in application layer before insert).
-- ============================================================
CREATE TABLE coin_ledger (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id),
  amount           BIGINT NOT NULL,          -- positive = credit, negative = debit
  balance_before   BIGINT NOT NULL,
  balance_after    BIGINT NOT NULL,
  transaction_type TEXT NOT NULL,
    -- 'purchase' | 'quest_reward' | 'gift_sent' | 'gift_received' |
    -- 'dm_cost' | 'subscription' | 'payout' | 'admin_grant' |
    -- 'refund' | 'ad_reward' | 'booster_pack'
  reference_id TEXT,   -- payment ref, gift id, etc.
  description  TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
-- Ledger is append-only — no UPDATE or DELETE allowed (enforced via RLS)

-- ============================================================
-- star_ledger — immutable, append-only prestige currency log
-- ============================================================
CREATE TABLE star_ledger (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id),
  amount           INTEGER NOT NULL,
  balance_before   INTEGER NOT NULL,
  balance_after    INTEGER NOT NULL,
  transaction_type TEXT NOT NULL,
  reference_id     TEXT,
  description      TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- xp_ledger — audit trail for every XP award
-- ============================================================
CREATE TABLE xp_ledger (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID    NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL,
  track       TEXT    NOT NULL DEFAULT 'main',
    -- 'main' | 'social' | 'creator' | 'competitor' |
    -- 'generosity' | 'knowledge' | 'explorer'
  source      TEXT NOT NULL,
    -- 'message' | 'daily_login' | 'quest' | 'gift' | 'guild_war' |
    -- 'room' | 'friend' | 'referral' | 'mystery_drop' | 'onboarding'
  reference_id TEXT,
  multiplier   DECIMAL(4,2) DEFAULT 1.0,
  base_amount  INTEGER NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- sessions — JWT refresh-token persistence
-- The access token lives only in Redis; the refresh token hash
-- is stored here so we can revoke on logout / device wipe.
-- ============================================================
CREATE TABLE sessions (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            UUID NOT NULL REFERENCES users(id),
  refresh_token_hash TEXT NOT NULL,
  device_info        JSONB,
  ip_address         INET,
  is_admin_session   BOOLEAN DEFAULT false,
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  last_used_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- friendships — bidirectional social graph edges
-- ============================================================
CREATE TABLE friendships (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id UUID NOT NULL REFERENCES users(id),
  addressee_id UUID NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(requester_id, addressee_id)
);

-- ============================================================
-- follows — one-directional follow graph (creator-audience)
-- ============================================================
CREATE TABLE follows (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id  UUID NOT NULL REFERENCES users(id),
  following_id UUID NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_id, following_id)
);

-- ============================================================
-- guilds — persistent team entities
-- ============================================================
CREATE TABLE guilds (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT NOT NULL UNIQUE,
  crest_emoji      TEXT NOT NULL DEFAULT '🛡️',
  description      TEXT,
  city             TEXT,
  country          TEXT DEFAULT 'NG',
  captain_id       UUID NOT NULL REFERENCES users(id),
  tier             TEXT NOT NULL DEFAULT 'bronze_1'
                     CHECK (tier IN (
                       'bronze_1','bronze_2','bronze_3',
                       'silver_1','silver_2','silver_3',
                       'gold_1','gold_2','gold_3',
                       'platinum_1','platinum_2','platinum_3',
                       'legend'
                     )),
  guild_xp         BIGINT  NOT NULL DEFAULT 0,
  member_count     INTEGER NOT NULL DEFAULT 1,
  treasury_balance BIGINT  NOT NULL DEFAULT 0, -- in coins
  treasury_cap     BIGINT  NOT NULL DEFAULT 50000,
  recruitment_type TEXT NOT NULL DEFAULT 'open'
                     CHECK (recruitment_type IN ('open', 'approval', 'invite_only')),
  wars_won         INTEGER NOT NULL DEFAULT 0,
  wars_lost        INTEGER NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- guild_members
-- ============================================================
CREATE TABLE guild_members (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id           UUID NOT NULL REFERENCES guilds(id),
  user_id            UUID NOT NULL REFERENCES users(id),
  role               TEXT NOT NULL DEFAULT 'member'
                       CHECK (role IN ('captain', 'veteran', 'recruiter', 'member')),
  contribution_score INTEGER NOT NULL DEFAULT 0,
  war_points_total   INTEGER NOT NULL DEFAULT 0,
  joined_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(guild_id, user_id)
);

-- ============================================================
-- guild_wars — 48-hour competitive events
-- ============================================================
CREATE TABLE guild_wars (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenger_guild_id  UUID NOT NULL REFERENCES guilds(id),
  defender_guild_id    UUID NOT NULL REFERENCES guilds(id),
  status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'final_hour', 'completed', 'cancelled')),
  challenger_points    BIGINT NOT NULL DEFAULT 0,
  defender_points      BIGINT NOT NULL DEFAULT 0,
  winner_guild_id      UUID REFERENCES guilds(id),
  starts_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at              TIMESTAMPTZ NOT NULL,
  final_hour_starts_at TIMESTAMPTZ NOT NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- rooms — public and private conversation spaces
-- ============================================================
CREATE TABLE rooms (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id  UUID NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  description TEXT,
  room_type   TEXT NOT NULL DEFAULT 'free_open'
                CHECK (room_type IN ('free_open', 'vip', 'drop', 'tipping', 'classroom', 'guild')),
  category    TEXT,
  city        TEXT,
  cover_image_url TEXT,

  -- Access
  is_public  BOOLEAN DEFAULT true,
  max_members INTEGER,
  member_count INTEGER NOT NULL DEFAULT 0,

  -- Pricing (in kobo)
  subscription_price_kobo BIGINT,
  entry_fee_kobo          BIGINT,

  -- ClassRoom fields
  curriculum JSONB,
  starts_at  TIMESTAMPTZ,
  ends_at    TIMESTAMPTZ,

  -- Guild room linkage
  guild_id UUID REFERENCES guilds(id),

  -- Stats
  total_messages INTEGER NOT NULL DEFAULT 0,
  health_score   INTEGER DEFAULT 100,

  -- Status flags
  is_active    BOOLEAN DEFAULT true,
  is_featured  BOOLEAN DEFAULT false,
  is_sponsored BOOLEAN DEFAULT false,
  sponsored_by TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- room_members
-- ============================================================
CREATE TABLE room_members (
  id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id  UUID NOT NULL REFERENCES rooms(id),
  user_id  UUID NOT NULL REFERENCES users(id),
  role     TEXT NOT NULL DEFAULT 'member'
             CHECK (role IN ('creator', 'co_moderator', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);

-- ============================================================
-- group_chats — standard group conversations
-- ============================================================
CREATE TABLE group_chats (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  creator_id   UUID NOT NULL REFERENCES users(id),
  avatar_emoji TEXT DEFAULT '👥',
  tag          TEXT CHECK (tag IN ('Study Group', 'Crew', 'Business')),
  member_count INTEGER NOT NULL DEFAULT 1,
  max_members  INTEGER NOT NULL DEFAULT 300,
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- group_chat_members
-- ============================================================
CREATE TABLE group_chat_members (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_chat_id UUID NOT NULL REFERENCES group_chats(id),
  user_id       UUID NOT NULL REFERENCES users(id),
  role          TEXT NOT NULL DEFAULT 'member'
                  CHECK (role IN ('admin', 'member')),
  joined_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_chat_id, user_id)
);

-- ============================================================
-- messages — DMs, Room messages, and group chat messages
-- Exactly one of recipient_id / room_id / group_chat_id
-- must be set (enforced in application layer).
-- ============================================================
CREATE TABLE messages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id     UUID NOT NULL REFERENCES users(id),

  -- Destination (one non-null)
  recipient_id  UUID REFERENCES users(id),   -- DM
  room_id       UUID REFERENCES rooms(id),   -- Room message
  group_chat_id UUID,                        -- Group chat (FK to group_chats)

  message_type  TEXT NOT NULL DEFAULT 'text'
                  CHECK (message_type IN (
                    'text', 'sticker', 'gif', 'gift', 'moment', 'system', 'broadcast'
                  )),
  content   TEXT,
  media_url TEXT,
  metadata  JSONB, -- gift data, sticker info, etc.

  -- Status
  is_deleted BOOLEAN DEFAULT false,
  is_flagged BOOLEAN DEFAULT false,

  -- Economy tracking
  coin_cost BIGINT DEFAULT 0,

  -- DM unlock tracking (2-reply rule for links/phone numbers)
  reply_count_from_recipient INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- message_reactions
-- ============================================================
CREATE TABLE message_reactions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id),
  user_id    UUID NOT NULL REFERENCES users(id),
  emoji      TEXT NOT NULL,
  is_custom  BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

-- ============================================================
-- quest_templates — reusable quest definitions
-- ============================================================
CREATE TABLE quest_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  quest_type  TEXT NOT NULL,
    -- 'messages' | 'room_join' | 'gift' | 'login_streak' |
    -- 'guild_quest' | 'xp_meta'
  target_value INTEGER NOT NULL,
  xp_reward    INTEGER NOT NULL DEFAULT 0,
  coin_reward  INTEGER NOT NULL DEFAULT 0,
  track        TEXT DEFAULT 'main',  -- which progression track this feeds
  min_plan     TEXT DEFAULT 'free',  -- minimum plan required
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- user_quests — daily quest instances assigned to each user
-- ============================================================
CREATE TABLE user_quests (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            UUID NOT NULL REFERENCES users(id),
  quest_template_id  UUID NOT NULL REFERENCES quest_templates(id),
  date               DATE NOT NULL,
  progress           INTEGER NOT NULL DEFAULT 0,
  target             INTEGER NOT NULL,
  is_completed       BOOLEAN DEFAULT false,
  completed_at       TIMESTAMPTZ,
  xp_reward          INTEGER NOT NULL,
  coin_reward        INTEGER NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, quest_template_id, date)
);

-- ============================================================
-- seasons — 8-week competitive cycles
-- ============================================================
CREATE TABLE seasons (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  theme          TEXT,
  description    TEXT,
  season_number  INTEGER NOT NULL,
  starts_at      TIMESTAMPTZ NOT NULL,
  ends_at        TIMESTAMPTZ NOT NULL,
  pass_price_coins INTEGER NOT NULL DEFAULT 500,
  is_active      BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- season_passes — records which users hold which tier of pass
-- ============================================================
CREATE TABLE season_passes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id),
  season_id    UUID NOT NULL REFERENCES seasons(id),
  tier         TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'paid')),
  purchased_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, season_id)
);

-- ============================================================
-- nemesis_assignments — weekly algorithmic rival pairings
-- ============================================================
CREATE TABLE nemesis_assignments (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id),
  nemesis_user_id UUID NOT NULL REFERENCES users(id),
  track          TEXT NOT NULL DEFAULT 'main',
  assigned_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  is_active      BOOLEAN DEFAULT true,
  UNIQUE(user_id, track, is_active)
);

-- ============================================================
-- reports — content and user reports
-- ============================================================
CREATE TABLE reports (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id         UUID NOT NULL REFERENCES users(id),
  reported_user_id    UUID REFERENCES users(id),
  reported_message_id UUID REFERENCES messages(id),
  reported_room_id    UUID REFERENCES rooms(id),
  reported_guild_id   UUID REFERENCES guilds(id),
  report_type         TEXT NOT NULL
                        CHECK (report_type IN (
                          'harassment', 'spam', 'fraud', 'sexual_content',
                          'impersonation', 'hate_speech', 'other'
                        )),
  description     TEXT,
  ai_category     TEXT,
  ai_confidence   DECIMAL(5,4),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN (
                      'pending', 'under_review', 'resolved_action',
                      'resolved_dismissed', 'escalated'
                    )),
  moderator_id    UUID REFERENCES users(id),
  resolution_note TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

-- ============================================================
-- payments — inward money flows (coin purchases, subscriptions)
-- ============================================================
CREATE TABLE payments (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              UUID NOT NULL REFERENCES users(id),
  payment_type         TEXT NOT NULL
                         CHECK (payment_type IN (
                           'coin_purchase', 'subscription', 'season_pass',
                           'booster_pack', 'room_entry'
                         )),
  amount_kobo          BIGINT NOT NULL,   -- in kobo / cents
  currency             TEXT NOT NULL DEFAULT 'NGN',
  provider             TEXT NOT NULL
                         CHECK (provider IN ('paystack', 'dodopayments', 'google_play')),
  provider_reference   TEXT UNIQUE,
  provider_transaction_id TEXT,
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN (
                           'pending', 'processing', 'completed', 'failed', 'refunded'
                         )),
  coins_credited       BIGINT,
  idempotency_key      TEXT UNIQUE,
  metadata             JSONB,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  completed_at         TIMESTAMPTZ
);

-- ============================================================
-- creator_earnings — line-item record of every creator income event
-- ============================================================
CREATE TABLE creator_earnings (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id       UUID NOT NULL REFERENCES users(id),
  source_type      TEXT NOT NULL
                     CHECK (source_type IN (
                       'gift', 'subscription', 'drop_entry',
                       'classroom_enrolment', 'sponsored_quest', 'merch', 'creator_fund'
                     )),
  gross_amount_kobo BIGINT NOT NULL,
  platform_fee_kobo BIGINT NOT NULL,
  net_amount_kobo   BIGINT NOT NULL,
  reference_id      TEXT,
  paid_out          BOOLEAN DEFAULT false,
  payout_id         UUID,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- creator_payouts — outward payment records
-- ============================================================
CREATE TABLE creator_payouts (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id             UUID NOT NULL REFERENCES users(id),
  amount_kobo            BIGINT NOT NULL,
  provider               TEXT NOT NULL,
  bank_account_reference TEXT,
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN (
                             'pending', 'awaiting_approval', 'approved',
                             'processing', 'completed', 'failed', 'rejected'
                           )),
  requires_manual_approval BOOLEAN DEFAULT false,
  approved_by_admin_id     UUID REFERENCES users(id),
  idempotency_key          TEXT UNIQUE,
  provider_reference       TEXT,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  processed_at             TIMESTAMPTZ
);

-- ============================================================
-- gift_items — the gift catalogue (admin-editable)
-- ============================================================
CREATE TABLE gift_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  emoji             TEXT NOT NULL,
  coin_price        INTEGER NOT NULL,
  tier              INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 3),
  animation_url     TEXT,
  is_limited_edition BOOLEAN DEFAULT false,
  season_id         UUID REFERENCES seasons(id),
  is_retired        BOOLEAN DEFAULT false,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- gifts — individual gift send events
-- ============================================================
CREATE TABLE gifts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id    UUID NOT NULL REFERENCES users(id),
  recipient_id UUID NOT NULL REFERENCES users(id),
  room_id      UUID REFERENCES rooms(id),
  gift_item_id UUID NOT NULL REFERENCES gift_items(id),
  coin_value   INTEGER NOT NULL,
  animation_url TEXT,
  message_id   UUID REFERENCES messages(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- announcement_modals — full-screen pop-up announcements
-- ============================================================
CREATE TABLE announcement_modals (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,     -- HTML or plain text
  content_type TEXT NOT NULL DEFAULT 'html' CHECK (content_type IN ('html', 'text')),
  is_active    BOOLEAN DEFAULT false,
  starts_at    TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ,
  target_plans TEXT[] DEFAULT ARRAY['free', 'plus', 'pro', 'max'],
  target_roles TEXT[] DEFAULT ARRAY[]::TEXT[],   -- empty = all roles
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- announcement_banners — persistent top-bar banners
-- ============================================================
CREATE TABLE announcement_banners (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content      TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'html' CHECK (content_type IN ('html', 'text')),
  is_active    BOOLEAN DEFAULT false,
  starts_at    TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ,
  target_plans TEXT[] DEFAULT ARRAY['free', 'plus', 'pro', 'max'],
  target_roles TEXT[] DEFAULT ARRAY[]::TEXT[],
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- user_modal_views — tracks which modal each user last saw
-- Used by serial rotation logic in the API.
-- ============================================================
CREATE TABLE user_modal_views (
  id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id  UUID NOT NULL REFERENCES users(id),
  modal_id UUID NOT NULL REFERENCES announcement_modals(id),
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, modal_id)
);

-- ============================================================
-- admin_messages — targeted or broadcast messages from admin
-- ============================================================
CREATE TABLE admin_messages (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_admin_id  UUID NOT NULL REFERENCES users(id),
  subject          TEXT,
  body             TEXT NOT NULL,
  broadcast_type   TEXT NOT NULL DEFAULT 'direct'
                     CHECK (broadcast_type IN ('direct', 'all', 'by_plan', 'by_role')),
  target_plans     TEXT[],
  target_roles     TEXT[],
  target_user_ids  UUID[],
  recipient_count  INTEGER DEFAULT 0,
  delivered_count  INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- admin_message_receipts — per-user delivery and read tracking
-- ============================================================
CREATE TABLE admin_message_receipts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_message_id UUID NOT NULL REFERENCES admin_messages(id),
  user_id          UUID NOT NULL REFERENCES users(id),
  is_delivered     BOOLEAN DEFAULT false,
  is_read          BOOLEAN DEFAULT false,
  delivered_at     TIMESTAMPTZ,
  read_at          TIMESTAMPTZ,
  UNIQUE(admin_message_id, user_id)
);

-- ============================================================
-- footer_scripts — injected JS/HTML snippets for analytics,
-- chat widgets, etc. (admin-managed, no deployment required)
-- ============================================================
CREATE TABLE footer_scripts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  is_active  BOOLEAN DEFAULT true,
  position   INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- referrals — two-tier referral tracking
-- ============================================================
CREATE TABLE referrals (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id UUID NOT NULL REFERENCES users(id),
  referred_id UUID NOT NULL REFERENCES users(id),
  tier        INTEGER NOT NULL DEFAULT 1 CHECK (tier IN (1, 2)),
  qualified   BOOLEAN DEFAULT false,
  coin_reward INTEGER,
  xp_reward   INTEGER,
  rewarded_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(referrer_id, referred_id)
);

-- ============================================================
-- subscriptions — plan subscription lifecycle records
-- ============================================================
CREATE TABLE subscriptions (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                UUID NOT NULL REFERENCES users(id),
  plan                   TEXT NOT NULL CHECK (plan IN ('plus', 'pro', 'max')),
  billing_period         TEXT NOT NULL DEFAULT 'monthly'
                           CHECK (billing_period IN ('monthly', 'annual')),
  status                 TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'cancelled', 'expired', 'paused')),
  starts_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at                TIMESTAMPTZ NOT NULL,
  auto_renew             BOOLEAN DEFAULT true,
  provider               TEXT,
  provider_subscription_id TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Seed data: quest templates
-- ============================================================
INSERT INTO quest_templates
  (title, description, quest_type, target_value, xp_reward, coin_reward, track, min_plan)
VALUES
  ('Message Marathon',   'Send 10 messages today',                   'messages',     10,   100,  10,  'social',     'free'),
  ('Room Explorer',      'Join a Room you haven''t visited before',  'room_join',     1,   150,   0,  'explorer',   'free'),
  ('Be Generous',        'Gift any user today',                      'gift',          1,    50,   5,  'generosity', 'free'),
  ('Streak Keeper',      'Log in for 7 consecutive days',            'login_streak',  7,   200,  50,  'main',       'free'),
  ('Guild Quest',        'Complete a Guild Quest contribution',       'guild_quest',   1,   200,   0,  'competitor', 'free'),
  ('XP Grinder',         'Earn 500 XP today',                        'xp_meta',     500,   100,  20,  'main',       'free'),
  ('Social Butterfly',   'Send 25 messages today',                   'messages',     25,   200,  20,  'social',     'plus'),
  ('Room Master',        'Visit 3 different Rooms today',            'room_join',     3,   300,  30,  'explorer',   'pro'),
  ('Super Gifter',       'Send 3 gifts today',                       'gift',          3,   150,  15,  'generosity', 'pro'),
  ('XP Champion',        'Earn 2000 XP today',                       'xp_meta',    2000,   300,  50,  'main',       'max');

-- ============================================================
-- Seed data: default gift catalogue
-- ============================================================
INSERT INTO gift_items (name, emoji, coin_price, tier) VALUES
  -- Tier 1: Social Gifts (1–50 Coins)
  ('Flower',          '🌸', 5,    1),
  ('Cold One',        '🍺', 10,   1),
  ('Respect',         '🤝', 15,   1),
  ('Fire',            '🔥', 25,   1),
  ('Big Brain',       '🧠', 40,   1),
  -- Tier 2: Flex Gifts (50–500 Coins)
  ('Trophy',          '🏆', 80,   2),
  ('Diamond',         '💎', 150,  2),
  ('Crown',           '👑', 300,  2),
  ('Rocket',          '🚀', 400,  2),
  ('Lion',            '🦁', 500,  2),
  -- Tier 3: Boss Gifts (500–5,000 Coins)
  ('Money Bag',       '💰', 800,  3),
  ('City Night',      '🌃', 1500, 3),
  ('Stadium Roar',    '🏟️', 2000, 3),
  ('Legendary Crown', '✨', 5000, 3);

-- ============================================================
-- Indexes
-- ============================================================

-- users
CREATE INDEX idx_users_username    ON users(username);
CREATE INDEX idx_users_email       ON users(email)       WHERE email IS NOT NULL;
CREATE INDEX idx_users_google_id   ON users(google_id)   WHERE google_id IS NOT NULL;
CREATE INDEX idx_users_telegram_id ON users(telegram_id) WHERE telegram_id IS NOT NULL;
CREATE INDEX idx_users_city        ON users(city)        WHERE city IS NOT NULL;
CREATE INDEX idx_users_plan        ON users(plan);
CREATE INDEX idx_users_xp_total    ON users(xp_total DESC);
CREATE INDEX idx_users_last_active ON users(last_active_at DESC);
CREATE INDEX idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;

-- coin / xp ledgers
CREATE INDEX idx_coin_ledger_user_id    ON coin_ledger(user_id);
CREATE INDEX idx_coin_ledger_created_at ON coin_ledger(created_at DESC);
CREATE INDEX idx_star_ledger_user_id    ON star_ledger(user_id);
CREATE INDEX idx_xp_ledger_user_id      ON xp_ledger(user_id);
CREATE INDEX idx_xp_ledger_track        ON xp_ledger(track);
CREATE INDEX idx_xp_ledger_created_at   ON xp_ledger(created_at DESC);

-- messages
CREATE INDEX idx_messages_sender_id    ON messages(sender_id);
CREATE INDEX idx_messages_recipient_id ON messages(recipient_id) WHERE recipient_id IS NOT NULL;
CREATE INDEX idx_messages_room_id      ON messages(room_id)      WHERE room_id IS NOT NULL;
CREATE INDEX idx_messages_group_chat   ON messages(group_chat_id) WHERE group_chat_id IS NOT NULL;
CREATE INDEX idx_messages_created_at   ON messages(created_at DESC);

-- rooms
CREATE INDEX idx_rooms_creator_id ON rooms(creator_id);
CREATE INDEX idx_rooms_city       ON rooms(city);
CREATE INDEX idx_rooms_type       ON rooms(room_type);
CREATE INDEX idx_rooms_is_active  ON rooms(is_active) WHERE is_active = true;
CREATE INDEX idx_rooms_guild_id   ON rooms(guild_id)  WHERE guild_id IS NOT NULL;

-- guilds & members
CREATE INDEX idx_guild_members_guild_id ON guild_members(guild_id);
CREATE INDEX idx_guild_members_user_id  ON guild_members(user_id);
CREATE INDEX idx_guilds_tier            ON guilds(tier);
CREATE INDEX idx_guilds_city            ON guilds(city);

-- friendships & follows
CREATE INDEX idx_friendships_requester ON friendships(requester_id);
CREATE INDEX idx_friendships_addressee ON friendships(addressee_id);
CREATE INDEX idx_follows_follower      ON follows(follower_id);
CREATE INDEX idx_follows_following     ON follows(following_id);

-- reports
CREATE INDEX idx_reports_status   ON reports(status);
CREATE INDEX idx_reports_reporter ON reports(reporter_id);

-- payments & payouts
CREATE INDEX idx_payments_user_id      ON payments(user_id);
CREATE INDEX idx_payments_status       ON payments(status);
CREATE INDEX idx_payments_provider_ref ON payments(provider_reference);
CREATE INDEX idx_creator_earnings_creator ON creator_earnings(creator_id);
CREATE INDEX idx_creator_payouts_creator  ON creator_payouts(creator_id);

-- sessions
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- quests
CREATE INDEX idx_user_quests_user_date ON user_quests(user_id, date);

-- nemesis
CREATE INDEX idx_nemesis_user_id ON nemesis_assignments(user_id);
