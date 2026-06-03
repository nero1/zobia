-- Migration 007: Feature completeness tables
-- Adds: guild_quests, guild_quest_contributions, guild_war_rematch_tokens,
--        branded_rooms, user_push_tokens, user_xp_boosters,
--        season_pass_milestones, user_season_pass_claims

-- Guild Quests (weekly collective challenges)
CREATE TABLE IF NOT EXISTS guild_quests (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id         UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  quest_type       TEXT NOT NULL DEFAULT 'collective',
  target_count     INTEGER NOT NULL DEFAULT 100,
  current_count    INTEGER NOT NULL DEFAULT 0,
  reward_guild_xp  INTEGER NOT NULL DEFAULT 500,
  reward_coins     INTEGER NOT NULL DEFAULT 200,
  week_start       TIMESTAMPTZ NOT NULL,
  week_end         TIMESTAMPTZ NOT NULL,
  is_completed     BOOLEAN DEFAULT false,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_quest_contributions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quest_id   UUID NOT NULL REFERENCES guild_quests(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rematch tokens (issued to war losers — 50% discount on next war)
CREATE TABLE IF NOT EXISTS guild_war_rematch_tokens (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id         UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  war_id           UUID NOT NULL REFERENCES guild_wars(id) ON DELETE CASCADE,
  discount_percent INTEGER NOT NULL DEFAULT 50,
  is_used          BOOLEAN DEFAULT false,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Branded / Sponsored Rooms
CREATE TABLE IF NOT EXISTS branded_rooms (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id          UUID REFERENCES rooms(id) ON DELETE SET NULL,
  brand_name       TEXT NOT NULL,
  brand_logo_url   TEXT,
  sponsor_budget_coins INTEGER NOT NULL DEFAULT 0,
  join_bonus_coins INTEGER NOT NULL DEFAULT 5,
  is_active        BOOLEAN DEFAULT true,
  starts_at        TIMESTAMPTZ,
  ends_at          TIMESTAMPTZ,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Push notification tokens (Expo push)
CREATE TABLE IF NOT EXISTS user_push_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  platform   TEXT NOT NULL DEFAULT 'android',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

-- Active XP booster packs
CREATE TABLE IF NOT EXISTS user_xp_boosters (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  multiplier DECIMAL(4,2) NOT NULL DEFAULT 2.0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Season Pass reward milestones
CREATE TABLE IF NOT EXISTS season_pass_milestones (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id    UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  milestone_xp INTEGER NOT NULL,
  tier         TEXT NOT NULL DEFAULT 'free',
  reward_type  TEXT NOT NULL,
  reward_value JSONB NOT NULL DEFAULT '{}',
  display_name TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_season_pass_claims (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id    UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  milestone_id UUID NOT NULL REFERENCES season_pass_milestones(id) ON DELETE CASCADE,
  claimed_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, milestone_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_guild_quests_guild_week ON guild_quests(guild_id, week_start);
CREATE INDEX IF NOT EXISTS idx_guild_quest_contributions_quest ON guild_quest_contributions(quest_id);
CREATE INDEX IF NOT EXISTS idx_guild_quest_contributions_user ON guild_quest_contributions(user_id);
CREATE INDEX IF NOT EXISTS idx_rematch_tokens_guild ON guild_war_rematch_tokens(guild_id) WHERE NOT is_used;
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user ON user_push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_user_xp_boosters_user_active ON user_xp_boosters(user_id) WHERE expires_at > NOW();
CREATE INDEX IF NOT EXISTS idx_season_pass_milestones_season ON season_pass_milestones(season_id, milestone_xp);
CREATE INDEX IF NOT EXISTS idx_user_season_pass_claims_user_season ON user_season_pass_claims(user_id, season_id);
