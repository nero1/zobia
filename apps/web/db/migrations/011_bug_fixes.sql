-- =============================================================================
-- Migration 011: Bug-fix schema changes
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS / DO $$ ... $$ guards.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- BUG-05: Replace leaderboard_snapshots plain UNIQUE with a COALESCE expression
-- index so NULL city / NULL season_id values are treated as equal (not distinct).
-- Standard UNIQUE constraints treat each NULL as a unique value which causes
-- duplicate rows instead of upserts.
-- ---------------------------------------------------------------------------

-- 1. Drop the old plain UNIQUE constraint (may be named differently depending
--    on how it was created; try both the inferred name and a positional name).
DO $$
BEGIN
  -- Try the constraint created by "UNIQUE(user_id, track, scope, city, season_id)"
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'leaderboard_snapshots'::regclass
       AND conname   = 'leaderboard_snapshots_user_id_track_scope_city_season_id_key'
  ) THEN
    ALTER TABLE leaderboard_snapshots
      DROP CONSTRAINT leaderboard_snapshots_user_id_track_scope_city_season_id_key;
  END IF;

  -- Fallback: drop any other unique constraint that covers the same columns
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'leaderboard_snapshots'::regclass
       AND contype   = 'u'
       AND conname  != 'leaderboard_snapshots_pkey'
  ) THEN
    -- Drop all non-PK unique constraints on this table safely via loop
    DECLARE
      r RECORD;
    BEGIN
      FOR r IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'leaderboard_snapshots'::regclass
           AND contype   = 'u'
      LOOP
        EXECUTE format('ALTER TABLE leaderboard_snapshots DROP CONSTRAINT IF EXISTS %I', r.conname);
      END LOOP;
    END;
  END IF;
END $$;

-- 2. Drop the old expression index if it was created by a previous attempt
DROP INDEX IF EXISTS leaderboard_snapshots_upsert_idx;

-- 3. Create the correct expression index (mirrors the Drizzle schema definition)
CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_snapshots_upsert_idx
  ON leaderboard_snapshots (
    user_id,
    track,
    scope,
    COALESCE(city, ''),
    COALESCE(season_id::text, '')
  );

-- ---------------------------------------------------------------------------
-- BUG-07: Remove the legacy two_fa_secret / two_fa_enabled duplicate columns
-- from the users table (the canonical columns are totp_secret / totp_enabled).
-- ---------------------------------------------------------------------------

ALTER TABLE users DROP COLUMN IF EXISTS two_fa_secret;
ALTER TABLE users DROP COLUMN IF EXISTS two_fa_enabled;

-- ---------------------------------------------------------------------------
-- BUG-08: Fix the FK in user_quest_decks to point at quest_templates instead
-- of the non-existent "quests" table (introduced in migration 006).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- Drop the wrong FK if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'user_quest_decks'::regclass
       AND conname   = 'user_quest_decks_quest_id_fkey'
  ) THEN
    ALTER TABLE user_quest_decks
      DROP CONSTRAINT user_quest_decks_quest_id_fkey;
  END IF;

  -- Add the correct FK (idempotent: only add if it doesn't already exist)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'user_quest_decks'::regclass
       AND conname   = 'user_quest_decks_quest_id_quest_templates_fkey'
  ) THEN
    ALTER TABLE user_quest_decks
      ADD CONSTRAINT user_quest_decks_quest_id_quest_templates_fkey
      FOREIGN KEY (quest_id) REFERENCES quest_templates(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- BUG-12 / BUG-17: New tables required by the gift, room, guild-war, season,
-- and push-token features that were missing from the original schema.
-- ---------------------------------------------------------------------------

-- gift_types: catalogue of sendable gifts (distinct from legacy gift_items)
CREATE TABLE IF NOT EXISTS gift_types (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               TEXT NOT NULL UNIQUE,
  emoji              TEXT NOT NULL,
  coin_cost          INTEGER NOT NULL,
  xp_value           INTEGER NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  is_limited_edition BOOLEAN NOT NULL DEFAULT false,
  is_retired         BOOLEAN NOT NULL DEFAULT false,
  season_id          UUID,
  metadata           JSONB,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- gifts: individual gift sends (uses gift_types, not the old gift_items)
CREATE TABLE IF NOT EXISTS gifts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gift_type_id UUID NOT NULL REFERENCES gift_types(id),
  message_id   UUID,
  room_id      UUID,
  coin_cost    INTEGER NOT NULL,
  metadata     JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gifts_recipient ON gifts(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gifts_sender    ON gifts(sender_id, created_at DESC);

-- guilds: already created in 001 but may be missing columns; no-op if present
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS last_war_ended_at TIMESTAMPTZ;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS wars_won  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS wars_lost INTEGER NOT NULL DEFAULT 0;

-- guild_wars: already in 001; add missing columns
ALTER TABLE guild_wars ADD COLUMN IF NOT EXISTS final_hour_starts_at TIMESTAMPTZ;
ALTER TABLE guild_wars ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ---------------------------------------------------------------------------
-- BUG-30: Immutable audit log for sensitive operations
-- (distinct from the admin_audit_log table in migration 001)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID,
  action     TEXT NOT NULL,
  target_type TEXT,
  target_id  TEXT,
  metadata   JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor      ON audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action     ON audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target     ON audit_log(target_type, target_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- BUG-31: Table for balance discrepancy audit records used by the nightly
-- reconcile-balances CRON
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_discrepancies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL,
  asset_type     TEXT NOT NULL,          -- 'xp' | 'coins'
  ledger_sum     BIGINT NOT NULL,
  wallet_balance BIGINT NOT NULL,
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved       BOOLEAN NOT NULL DEFAULT false,
  resolved_at    TIMESTAMPTZ,
  notes          TEXT,
  UNIQUE (user_id, asset_type, detected_at)
);

CREATE INDEX IF NOT EXISTS idx_audit_discrepancies_unresolved
  ON audit_discrepancies(detected_at DESC)
  WHERE resolved = false;

-- ---------------------------------------------------------------------------
-- BUG-38: Dead-letter queue for failed XP awards (used by safeAwardXP retry)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS failed_xp_awards (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL,
  amount         INTEGER NOT NULL,
  track          TEXT NOT NULL,
  source         TEXT NOT NULL,
  reference_id   TEXT,
  error_message  TEXT,
  failed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retry_count    INTEGER NOT NULL DEFAULT 0,
  last_retried_at TIMESTAMPTZ,
  resolved_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_failed_xp_awards_pending
  ON failed_xp_awards(failed_at ASC)
  WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- user_push_tokens: BUG-17 requires a per-token row model (not one row per
-- user/platform pair).  Alter the unique constraint to be (user_id, token).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- The original 001 table has UNIQUE(user_id, platform); we need UNIQUE(user_id, token).
  -- Add last_seen_at column first.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'user_push_tokens' AND column_name = 'last_seen_at'
  ) THEN
    ALTER TABLE user_push_tokens ADD COLUMN last_seen_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  -- Drop old unique constraint (user_id, platform) if it still exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'user_push_tokens'::regclass
       AND conname   = 'user_push_tokens_user_id_platform_key'
  ) THEN
    ALTER TABLE user_push_tokens
      DROP CONSTRAINT user_push_tokens_user_id_platform_key;
  END IF;
END $$;

-- Add the new unique index if not present
CREATE UNIQUE INDEX IF NOT EXISTS user_push_tokens_user_token_idx
  ON user_push_tokens(user_id, token);
