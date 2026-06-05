-- ============================================================
-- Migration 026: PRD final gaps
-- ============================================================
-- Covers:
--   1. conversation_scores streak tracking (last_message_date)
--   2. xp_ledger description column for milestone claims
--   3. guilds.deleted_at safety index
--   4. sponsored_quests.platform_share_percent default
--   5. creator_kyc.is_encrypted column (safety if 025 didn't run)

-- ─── 1. conversation_scores: track last message date for streak ──────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversation_scores' AND column_name = 'last_message_date'
  ) THEN
    ALTER TABLE conversation_scores ADD COLUMN last_message_date DATE;
  END IF;
END$$;

-- ─── 2. xp_ledger: description column (used by season milestone claims) ─────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'xp_ledger' AND column_name = 'description'
  ) THEN
    ALTER TABLE xp_ledger ADD COLUMN description TEXT;
  END IF;
END$$;

-- ─── 3. guilds.deleted_at column (referenced in cron but may be missing) ────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'guilds' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE guilds ADD COLUMN deleted_at TIMESTAMPTZ;
  END IF;
END$$;

-- ─── 4. sponsored_quests: platform_share_percent default safety ─────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sponsored_quests' AND column_name = 'platform_share_percent'
  ) THEN
    ALTER TABLE sponsored_quests
      ADD COLUMN platform_share_percent INTEGER NOT NULL DEFAULT 30,
      ADD COLUMN creator_share_percent  INTEGER NOT NULL DEFAULT 70;
  END IF;
END$$;

-- ─── 5. creator_kyc.is_encrypted safety ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'creator_kyc' AND column_name = 'is_encrypted'
  ) THEN
    ALTER TABLE creator_kyc ADD COLUMN is_encrypted BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END$$;

-- ─── 6. guild_tier_history safety (if migration 025 didn't run) ─────────────
CREATE TABLE IF NOT EXISTS guild_tier_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id    UUID        NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  from_tier   TEXT        NOT NULL,
  to_tier     TEXT        NOT NULL,
  guild_xp_at BIGINT      NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
