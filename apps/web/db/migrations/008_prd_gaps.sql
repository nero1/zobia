-- Migration 008: PRD gaps — new tables, columns, and x_manifest seed data

-- 1. User PIN storage (4-digit PIN hashed with bcrypt)
CREATE TABLE IF NOT EXISTS user_pins (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pin_hash   TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- 2. Room pins (user bookmarked/pinned rooms, plan-limited)
CREATE TABLE IF NOT EXISTS room_pins (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, room_id)
);

-- 3. Track milestone unlocks log (which milestones have been awarded)
CREATE TABLE IF NOT EXISTS track_milestone_unlocks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track           TEXT NOT NULL,
  milestone_level INTEGER NOT NULL,
  unlocked_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, track, milestone_level)
);

-- 4. Monthly gift drop events
CREATE TABLE IF NOT EXISTS monthly_gift_drops (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gift_item_id    UUID REFERENCES gift_items(id),
  title           TEXT NOT NULL,
  available_from  TIMESTAMPTZ NOT NULL,
  available_until TIMESTAMPTZ NOT NULL,
  announced_at    TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Conversation score sticker reaction unlocks
CREATE TABLE IF NOT EXISTS dm_score_sticker_unlocks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id_1       TEXT NOT NULL,
  user_id_2       TEXT NOT NULL,
  reaction_set_id UUID REFERENCES reaction_sets(id) ON DELETE CASCADE,
  unlocked_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id_1, user_id_2, reaction_set_id)
);

-- 6. Guild tier below-minimum tracking
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS below_min_since TIMESTAMPTZ;

-- 7. Users: onboarding nudge tracking
ALTER TABLE users ADD COLUMN IF NOT EXISTS nudge_email_shown_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nudge_email_dismissed_at TIMESTAMPTZ;

-- 8. GDPR data export requests
CREATE TABLE IF NOT EXISTS data_export_requests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  download_url TEXT,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 9. Leaderboard rank snapshots (for ripple notifications)
CREATE TABLE IF NOT EXISTS leaderboard_rank_snapshots (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope      TEXT NOT NULL DEFAULT 'global',
  rank       INTEGER NOT NULL,
  xp         BIGINT NOT NULL,
  snapped_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, scope)
);

-- 10. Users table: admin TOTP columns (for mandatory 2FA — PRD §20)
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;

-- 11. Users table: chat theme (personalised UI — PRD §5)
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_theme TEXT NOT NULL DEFAULT 'default';

-- 12. Users table: onboarding personalization from Vibe Quiz (PRD §4)
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_personalization JSONB;

-- 13. track_milestone_unlocks: unlock_key column (referenced in queries)
ALTER TABLE track_milestone_unlocks ADD COLUMN IF NOT EXISTS unlock_key TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_pins_user ON user_pins(user_id);
CREATE INDEX IF NOT EXISTS idx_room_pins_user ON room_pins(user_id);
CREATE INDEX IF NOT EXISTS idx_room_pins_room ON room_pins(room_id);
CREATE INDEX IF NOT EXISTS idx_track_milestone_unlocks_user ON track_milestone_unlocks(user_id);
CREATE INDEX IF NOT EXISTS idx_monthly_gift_drops_active ON monthly_gift_drops(available_from, available_until) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_dm_score_sticker_unlocks_users ON dm_score_sticker_unlocks(user_id_1, user_id_2);
CREATE INDEX IF NOT EXISTS idx_data_export_requests_user ON data_export_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_data_export_requests_status ON data_export_requests(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_leaderboard_rank_snapshots_user_scope ON leaderboard_rank_snapshots(user_id, scope);

-- 10. Seed x_manifest with all PRD-required feature flags and config
INSERT INTO x_manifest (key, value, description) VALUES
  ('feature_community_notes',   'true',     'Enable Community Notes crowdsourced fact-checking'),
  ('feature_star_purchase',     'false',    'Allow direct Star currency purchase with money'),
  ('feature_nemesis_system',    'true',     'Enable Nemesis rival assignment and challenges'),
  ('feature_guild_wars',        'true',     'Enable Guild Wars system'),
  ('feature_classrooms',        'true',     'Enable ClassRoom knowledge rooms'),
  ('feature_business_accounts', 'true',     'Enable Business Account tiers'),
  ('feature_admob_ads',         'true',     'Show AdMob ads to free-tier users'),
  ('feature_rewarded_ads',      'true',     'Allow free-tier users to earn coins via rewarded ads'),
  ('feature_merch_store',       'true',     'Enable Creator Merch Store (Elite tier+)'),
  ('feature_platform_council',  'true',     'Enable Platform Council (top 50 by Legacy Score)'),
  ('feature_alliance_system',   'true',     'Enable Guild Alliance system (Platinum+)'),
  ('feature_pin_auth',          'true',     'Allow users to set a 4-digit PIN'),
  ('captcha_provider',          'recaptcha','CAPTCHA provider: recaptcha | turnstile | none'),
  ('auth_google_enabled',       'true',     'Enable Google OAuth login'),
  ('auth_telegram_enabled',     'true',     'Enable Telegram Login'),
  ('gif_provider',              'giphy',    'GIF search provider: giphy | tenor'),
  ('pwa_web_enabled',           'true',     'Enable PWA for web browser'),
  ('pwa_android_enabled',       'false',    'Enable PWA for Android/mobile'),
  ('pwa_ios_enabled',           'false',    'Enable PWA for iOS'),
  ('minimum_age',               '18',       'Minimum age for registration (years)'),
  ('coin_to_cash_rate',         '100',      'Coins per NGN 1 (100 coins = ₦1)'),
  ('payout_threshold_kobo',     '100000',   'Minimum payout in kobo (₦1000 default)'),
  ('payout_large_approval_kobo','5000000',  'Withdrawals above this kobo amount require manual approval'),
  ('season_pass_price_coins',   '500',      'Default Season Pass price in Coins'),
  ('vip_room_min_price_kobo',   '20000',    'Minimum VIP Room subscription price (₦200)'),
  ('vip_room_max_price_kobo',   '1000000',  'Maximum VIP Room subscription price (₦10,000)'),
  ('deep_link_base_url',        'https://zobia.app', 'Base URL for deep link generation')
ON CONFLICT (key) DO NOTHING;
