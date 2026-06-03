-- Migration 011: Second pass of missing tables (referenced in routes but never defined)

-- ============================================================
-- 1. dm_conversations — DM conversation metadata
-- ============================================================
-- Each row represents the canonical record for a DM thread between two users.
-- user_id_1 is always LEAST(user_a, user_b) and user_id_2 is GREATEST to
-- ensure a single row per pair (enforced by UNIQUE).
CREATE TABLE IF NOT EXISTS dm_conversations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id_1   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_2   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id_1, user_id_2),
  CHECK(user_id_1 < user_id_2)
);

CREATE INDEX IF NOT EXISTS idx_dm_conversations_user1 ON dm_conversations(user_id_1);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_user2 ON dm_conversations(user_id_2);

-- ============================================================
-- 2. user_season_passes — writable replacement for the dropped VIEW
-- ============================================================
-- Migration 003 created then immediately dropped a VIEW aliasing season_passes.
-- The pass routes (purchase, milestone claim, leaderboard) all INSERT/UPDATE
-- this table directly, so it must be a real table.
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

CREATE INDEX IF NOT EXISTS idx_user_season_passes_user   ON user_season_passes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_season_passes_season ON user_season_passes(season_id);

-- ============================================================
-- 3. leaderboard_snapshots — materialised XP snapshot per user/track/scope
-- ============================================================
-- Written by /api/xp/award and read by /api/leaderboards and cron/leaderboards.
-- The ON CONFLICT target is (user_id, track, scope, city, season_id).
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track          TEXT NOT NULL DEFAULT 'main',
  scope          TEXT NOT NULL DEFAULT 'global',  -- global | national | city | guild | season
  city           TEXT,
  season_id      UUID REFERENCES seasons(id) ON DELETE CASCADE,
  xp_value       BIGINT NOT NULL DEFAULT 0,
  rank_position  INTEGER,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, track, scope, city, season_id)
);

CREATE INDEX IF NOT EXISTS idx_lb_snapshots_user   ON leaderboard_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_lb_snapshots_scope  ON leaderboard_snapshots(scope, track, xp_value DESC);
CREATE INDEX IF NOT EXISTS idx_lb_snapshots_city   ON leaderboard_snapshots(city, track, xp_value DESC) WHERE city IS NOT NULL;

-- ============================================================
-- 4. room_subscriptions — VIP room subscription records
-- ============================================================
-- Created by /api/rooms/[roomId]/subscribe on successful payment.
-- Queried by /api/creator/tier to count active subscribers.
CREATE TABLE IF NOT EXISTS room_subscriptions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id      UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'expired', 'cancelled')),
  amount_kobo  BIGINT,
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_room_subscriptions_room   ON room_subscriptions(room_id, status);
CREATE INDEX IF NOT EXISTS idx_room_subscriptions_user   ON room_subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_room_subscriptions_expiry ON room_subscriptions(expires_at) WHERE status = 'active';

-- ============================================================
-- 5. nemesis_challenges — active nemesis duel requests
-- ============================================================
-- Created by /api/nemesis when a user challenges another to a 30-day XP duel.
CREATE TABLE IF NOT EXISTS nemesis_challenges (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenger_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenged_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'accepted', 'declined', 'completed', 'expired')),
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nemesis_challenges_challenger ON nemesis_challenges(challenger_id, status);
CREATE INDEX IF NOT EXISTS idx_nemesis_challenges_challenged ON nemesis_challenges(challenged_id, status);

-- ============================================================
-- 6. room_moderation_log — audit log for room moderation actions
-- ============================================================
-- Written by /api/rooms/[roomId]/moderation on every moderator action.
CREATE TABLE IF NOT EXISTS room_moderation_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  moderator_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_room_mod_log_room ON room_moderation_log(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_mod_log_target ON room_moderation_log(target_user_id) WHERE target_user_id IS NOT NULL;

-- ============================================================
-- 7. guild_applications — pending join applications for approval-gated guilds
-- ============================================================
CREATE TABLE IF NOT EXISTS guild_applications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id    UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'approved', 'rejected')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_guild_applications_guild ON guild_applications(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_guild_applications_user  ON guild_applications(user_id);

-- ============================================================
-- 8. guild_invites — invite tokens for invite_only guilds
-- ============================================================
CREATE TABLE IF NOT EXISTS guild_invites (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id         UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  token            TEXT NOT NULL UNIQUE,
  invited_user_id  UUID REFERENCES users(id) ON DELETE CASCADE,  -- NULL = open invite
  created_by       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at       TIMESTAMPTZ NOT NULL,
  used_at          TIMESTAMPTZ,
  used_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guild_invites_guild  ON guild_invites(guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_invites_token  ON guild_invites(token);

-- ============================================================
-- 9. guild_treasury_ledger — financial audit log for guild treasury
-- ============================================================
-- Written by /api/guilds/[guildId]/treasury on deposits and withdrawals.
CREATE TABLE IF NOT EXISTS guild_treasury_ledger (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id         UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  amount           BIGINT NOT NULL,  -- positive = deposit, negative = withdrawal
  balance_before   BIGINT NOT NULL,
  balance_after    BIGINT NOT NULL,
  transaction_type TEXT NOT NULL,
  description      TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guild_treasury_ledger_guild ON guild_treasury_ledger(guild_id, created_at DESC);

-- ============================================================
-- 10. app_settings — key-value store for runtime app configuration
-- ============================================================
-- Written/read by /api/manifest/[key]. Key is the primary key so
-- ON CONFLICT (key) DO UPDATE works correctly.
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 11. system_alerts — admin-visible platform alerts
-- ============================================================
-- Written by cron jobs and internal monitors; read/resolved via /api/admin/alerts.
CREATE TABLE IF NOT EXISTS system_alerts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type            TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'info'
    CHECK(severity IN ('info', 'warning', 'critical')),
  message         TEXT NOT NULL,
  metadata        JSONB,
  resolved        BOOLEAN NOT NULL DEFAULT false,
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_alerts_unresolved ON system_alerts(severity, created_at DESC) WHERE resolved = false;
