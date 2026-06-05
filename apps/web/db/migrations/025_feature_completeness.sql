-- ============================================================
-- Migration 025: Feature completeness — automod, promotions,
-- guild tier promotion, KYC encryption flags, seasons admin,
-- sponsored quest payouts, and schema alignment fixes.
-- ============================================================

-- ─── 1. rooms.moderation_rules ─────────────────────────────────────────────
-- Stores per-room automod configuration as JSON:
--   { blockLinks, blockPhoneNumbers, blockEmails, slowModeSeconds,
--     newMemberPostHoldHours, requireApproval }
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rooms' AND column_name = 'moderation_rules'
  ) THEN
    ALTER TABLE rooms ADD COLUMN moderation_rules JSONB;
  END IF;
END$$;

-- ─── 2. room_promotions ─────────────────────────────────────────────────────
-- Tracks paid room promotion slots.
CREATE TABLE IF NOT EXISTS room_promotions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  creator_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coin_cost   INTEGER     NOT NULL DEFAULT 0,
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at     TIMESTAMPTZ NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(room_id)
);

CREATE INDEX IF NOT EXISTS idx_room_promotions_active
  ON room_promotions(room_id, is_active, ends_at);

-- ─── 3. sponsored_quests completion & payout support ────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sponsored_quest_applications' AND column_name = 'status'
  ) THEN
    ALTER TABLE sponsored_quest_applications
      ADD COLUMN status TEXT NOT NULL DEFAULT 'applied'
        CHECK (status IN ('applied', 'accepted', 'completed', 'approved', 'rejected', 'paid'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sponsored_quest_applications' AND column_name = 'completion_proof'
  ) THEN
    ALTER TABLE sponsored_quest_applications ADD COLUMN completion_proof TEXT;
    ALTER TABLE sponsored_quest_applications ADD COLUMN completed_at     TIMESTAMPTZ;
    ALTER TABLE sponsored_quest_applications ADD COLUMN approved_at      TIMESTAMPTZ;
    ALTER TABLE sponsored_quest_applications ADD COLUMN payout_coins     INTEGER;
    ALTER TABLE sponsored_quest_applications ADD COLUMN paid_at          TIMESTAMPTZ;
  END IF;
END$$;

-- ─── 4. guild tier promotion log ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guild_tier_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id    UUID        NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  from_tier   TEXT        NOT NULL,
  to_tier     TEXT        NOT NULL,
  guild_xp_at BIGINT      NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 5. creator_kyc encryption marker ───────────────────────────────────────
-- Flag indicating whether sensitive fields (bvn_last4, bank_account_number)
-- are stored as pgcrypto-encrypted ciphertext.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'creator_kyc' AND column_name = 'is_encrypted'
  ) THEN
    ALTER TABLE creator_kyc ADD COLUMN is_encrypted BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END$$;

-- ─── 6. seasons.created_by — track which admin created each season ──────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seasons' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE seasons ADD COLUMN created_by UUID REFERENCES users(id);
  END IF;
END$$;

-- ─── 7. seasons.description ─────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seasons' AND column_name = 'description'
  ) THEN
    ALTER TABLE seasons ADD COLUMN description TEXT;
  END IF;
END$$;

-- ─── 8. users.creator_role ──────────────────────────────────────────────────
-- Explicit flag for users who have been granted creator status by admin.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'creator_role'
  ) THEN
    ALTER TABLE users ADD COLUMN creator_role BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END$$;

-- ─── 9. rooms.is_featured ─────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rooms' AND column_name = 'is_featured'
  ) THEN
    ALTER TABLE rooms ADD COLUMN is_featured BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END$$;

-- ─── 10. users.is_seed ──────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'is_seed'
  ) THEN
    ALTER TABLE users ADD COLUMN is_seed BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END$$;

-- ─── 11. room_members.joined_at default ─────────────────────────────────────
-- Ensure joined_at has a default (safe if already exists)
DO $$
BEGIN
  ALTER TABLE room_members ALTER COLUMN joined_at SET DEFAULT NOW();
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

-- ─── 12. users.onboarding_personalization (alias for vibe_quiz_responses) ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'onboarding_personalization'
  ) THEN
    ALTER TABLE users ADD COLUMN onboarding_personalization JSONB;
  END IF;
END$$;

-- ─── 13. users.prestige_cycle_boost_expires_at ──────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'prestige_cycle_boost_expires_at'
  ) THEN
    ALTER TABLE users ADD COLUMN prestige_cycle_boost_expires_at TIMESTAMPTZ;
  END IF;
END$$;

-- ─── 14. users.guild_id ────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'guild_id'
  ) THEN
    ALTER TABLE users ADD COLUMN guild_id UUID REFERENCES guilds(id);
  END IF;
END$$;

-- ─── 15. users.chat_theme ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'chat_theme'
  ) THEN
    ALTER TABLE users ADD COLUMN chat_theme TEXT NOT NULL DEFAULT 'default';
  END IF;
END$$;

-- ─── 16. rooms.metadata JSONB column ───────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rooms' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE rooms ADD COLUMN metadata JSONB;
  END IF;
END$$;

-- ─── 17. payments table ensure created_at ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE payments ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END$$;

-- ─── 18a. room_messages.is_pending_approval ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'room_messages' AND column_name = 'is_pending_approval'
  ) THEN
    ALTER TABLE room_messages ADD COLUMN is_pending_approval BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END$$;

-- ─── 18. xp_ledger ceremony_room_id (for graduation XP references) ─────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'xp_ledger' AND column_name = 'ceremony_room_id'
  ) THEN
    ALTER TABLE xp_ledger ADD COLUMN ceremony_room_id UUID;
  END IF;
END$$;
