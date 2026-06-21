-- Migration 0025: Fix all bugs from custom-bugs-report.md
-- Covers: RLS-01, RLS-02, XP-02, GUILD-01, LB-01, PUSH-02, DISC-01, SEASON-01,
--         QUEST-01, PRIVACY-01

-- =============================================================================
-- RLS-01: Fix broken users RLS policy (OR deleted_at IS NULL defeats policy)
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'users_self_or_admin'
  ) THEN
    DROP POLICY users_self_or_admin ON users;
  END IF;
END
$$;

CREATE POLICY users_self_or_admin ON users
  USING (
    id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.is_admin', true) = 'true'
  );

-- Force table owner to also pass RLS (defense-in-depth)
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- RLS-02: Enable RLS on financial and personal data tables
-- =============================================================================

-- payments
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payments' AND policyname = 'payments_self_or_admin') THEN
    CREATE POLICY payments_self_or_admin ON payments
      USING (
        user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        OR current_setting('app.is_admin', true) = 'true'
        OR current_setting('app.is_system', true) = 'true'
      );
  END IF;
END
$$;

-- creator_payouts
ALTER TABLE creator_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_payouts FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'creator_payouts' AND policyname = 'creator_payouts_self_or_admin') THEN
    CREATE POLICY creator_payouts_self_or_admin ON creator_payouts
      USING (
        creator_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        OR current_setting('app.is_admin', true) = 'true'
        OR current_setting('app.is_system', true) = 'true'
      );
  END IF;
END
$$;

-- gifts
ALTER TABLE gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gifts FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'gifts' AND policyname = 'gifts_self_or_admin') THEN
    CREATE POLICY gifts_self_or_admin ON gifts
      USING (
        sender_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        OR recipient_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        OR current_setting('app.is_admin', true) = 'true'
        OR current_setting('app.is_system', true) = 'true'
      );
  END IF;
END
$$;

-- messages (direct messages)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
    EXECUTE 'ALTER TABLE messages ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE messages FORCE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'messages' AND policyname = 'messages_self_or_admin') THEN
      EXECUTE $policy$
        CREATE POLICY messages_self_or_admin ON messages
          USING (
            sender_id = NULLIF(current_setting('app.user_id', true), '')::uuid
            OR recipient_id = NULLIF(current_setting('app.user_id', true), '')::uuid
            OR current_setting('app.is_admin', true) = 'true'
            OR current_setting('app.is_system', true) = 'true'
          )
      $policy$;
    END IF;
  END IF;
END
$$;

-- kyc_submissions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'kyc_submissions') THEN
    EXECUTE 'ALTER TABLE kyc_submissions ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE kyc_submissions FORCE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kyc_submissions' AND policyname = 'kyc_submissions_self_or_admin') THEN
      EXECUTE $policy$
        CREATE POLICY kyc_submissions_self_or_admin ON kyc_submissions
          USING (
            user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
            OR current_setting('app.is_admin', true) = 'true'
            OR current_setting('app.is_system', true) = 'true'
          )
      $policy$;
    END IF;
  END IF;
END
$$;

-- creator_kyc
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'creator_kyc') THEN
    EXECUTE 'ALTER TABLE creator_kyc ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE creator_kyc FORCE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'creator_kyc' AND policyname = 'creator_kyc_self_or_admin') THEN
      EXECUTE $policy$
        CREATE POLICY creator_kyc_self_or_admin ON creator_kyc
          USING (
            creator_id = NULLIF(current_setting('app.user_id', true), '')::uuid
            OR current_setting('app.is_admin', true) = 'true'
            OR current_setting('app.is_system', true) = 'true'
          )
      $policy$;
    END IF;
  END IF;
END
$$;

-- System/DLQ tables: admin + system actor access
-- failed_xp_awards
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'failed_xp_awards') THEN
    EXECUTE 'ALTER TABLE failed_xp_awards ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'failed_xp_awards' AND policyname = 'failed_xp_awards_admin_or_system') THEN
      EXECUTE $policy$
        CREATE POLICY failed_xp_awards_admin_or_system ON failed_xp_awards
          USING (
            current_setting('app.is_admin', true) = 'true'
            OR current_setting('app.is_system', true) = 'true'
          )
      $policy$;
    END IF;
  END IF;
END
$$;

-- =============================================================================
-- XP-02: Widen xp_ledger.amount and failed_xp_awards.amount to bigint
-- =============================================================================

ALTER TABLE xp_ledger ALTER COLUMN amount TYPE bigint;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'failed_xp_awards' AND column_name = 'amount') THEN
    EXECUTE 'ALTER TABLE failed_xp_awards ALTER COLUMN amount TYPE bigint';
  END IF;
END
$$;

-- =============================================================================
-- GUILD-01: Add idempotency to guild_treasury_ledger
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'guild_treasury_ledger') THEN
    -- Add reference_id column if not present
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'guild_treasury_ledger' AND column_name = 'reference_id'
    ) THEN
      EXECUTE 'ALTER TABLE guild_treasury_ledger ADD COLUMN reference_id text';
    END IF;

    -- Create partial unique index for idempotency
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'guild_treasury_ledger' AND indexname = 'guild_treasury_ledger_idem_idx'
    ) THEN
      EXECUTE 'CREATE UNIQUE INDEX guild_treasury_ledger_idem_idx ON guild_treasury_ledger (guild_id, transaction_type, reference_id) WHERE reference_id IS NOT NULL';
    END IF;
  END IF;
END
$$;

-- =============================================================================
-- LB-01: Add rank column to leaderboard_snapshots
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leaderboard_snapshots' AND column_name = 'rank'
  ) THEN
    EXECUTE 'ALTER TABLE leaderboard_snapshots ADD COLUMN rank integer';
  END IF;
END
$$;

-- =============================================================================
-- PUSH-02: Add error_code column to push_tickets
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'push_tickets') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'push_tickets' AND column_name = 'error_code'
    ) THEN
      EXECUTE 'ALTER TABLE push_tickets ADD COLUMN error_code text';
    END IF;
  END IF;
END
$$;

-- =============================================================================
-- KYC-01: Add is_encrypted flag to creator_bank_accounts
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'creator_bank_accounts') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'creator_bank_accounts' AND column_name = 'is_encrypted'
    ) THEN
      EXECUTE 'ALTER TABLE creator_bank_accounts ADD COLUMN is_encrypted boolean NOT NULL DEFAULT false';
    END IF;
  END IF;
END
$$;

-- =============================================================================
-- DISC-01: Remove unique constraint from audit_discrepancies, add history columns
-- =============================================================================

DO $$
DECLARE
  idx_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_discrepancies') THEN
    -- Drop any unique index on (user_id, asset_type) that prevents history.
    -- Look up the actual index name dynamically to handle any naming convention.
    FOR idx_name IN
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'audit_discrepancies'
        AND indexdef ILIKE '%unique%'
        AND (indexdef ILIKE '%(user_id%asset_type%' OR indexdef ILIKE '%(asset_type%user_id%')
    LOOP
      EXECUTE format('DROP INDEX IF EXISTS %I', idx_name);
    END LOOP;

    -- Add detected_at column if missing
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'audit_discrepancies' AND column_name = 'detected_at'
    ) THEN
      EXECUTE 'ALTER TABLE audit_discrepancies ADD COLUMN detected_at timestamptz DEFAULT NOW()';
    END IF;

    -- Add resolved column if missing
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'audit_discrepancies' AND column_name = 'resolved'
    ) THEN
      EXECUTE 'ALTER TABLE audit_discrepancies ADD COLUMN resolved boolean NOT NULL DEFAULT false';
    END IF;

    -- Add partial index for active discrepancies
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'audit_discrepancies' AND indexname = 'audit_discrepancies_active_idx'
    ) THEN
      EXECUTE 'CREATE INDEX audit_discrepancies_active_idx ON audit_discrepancies (user_id, asset_type) WHERE resolved = false';
    END IF;
  END IF;
END
$$;

-- Also add a notes column for auto-correction annotations if missing
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_discrepancies') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'audit_discrepancies' AND column_name = 'notes'
    ) THEN
      EXECUTE 'ALTER TABLE audit_discrepancies ADD COLUMN notes text';
    END IF;
  END IF;
END
$$;

-- =============================================================================
-- SEASON-01: Add rankings_reset_at to seasons table
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'seasons') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'seasons' AND column_name = 'rankings_reset_at'
    ) THEN
      EXECUTE 'ALTER TABLE seasons ADD COLUMN rankings_reset_at timestamptz';
    END IF;
  END IF;
END
$$;

-- =============================================================================
-- QUEST-01: Add partial index for deck_completion xp_ledger lookups
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_xp_ledger_deck_completion
  ON xp_ledger (user_id, reference_id)
  WHERE source = 'deck_completion' AND reference_id IS NOT NULL;

-- =============================================================================
-- PRIVACY-01: Add sitemap_opt_out column to users table
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'sitemap_opt_out'
  ) THEN
    EXECUTE 'ALTER TABLE users ADD COLUMN sitemap_opt_out boolean NOT NULL DEFAULT false';
  END IF;
END
$$;
