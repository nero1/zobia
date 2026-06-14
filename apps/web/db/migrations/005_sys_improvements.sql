-- 005_sys_improvements.sql
--
-- SYS-01: Dead-letter queue for failed XP awards
-- SYS-02: Audit discrepancy table for nightly ledger reconciliation

-- ---------------------------------------------------------------------------
-- SYS-01: failed_xp_awards (XP dead-letter queue)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS failed_xp_awards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL,
  amount           INTEGER      NOT NULL CHECK (amount > 0),
  track            TEXT         NOT NULL,
  source           TEXT         NOT NULL,
  reference_id     TEXT         NULL,
  error_message    TEXT         NULL,
  failed_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  retry_count      INTEGER      NOT NULL DEFAULT 0,
  last_retried_at  TIMESTAMPTZ  NULL,
  resolved_at      TIMESTAMPTZ  NULL,

  -- Idempotency: only deduplicate when a stable reference_id is supplied
  CONSTRAINT uq_failed_xp_reference
    UNIQUE (user_id, source, reference_id)
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS idx_failed_xp_awards_pending
  ON failed_xp_awards (retry_count, last_retried_at)
  WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- SYS-02: audit_discrepancies (nightly ledger reconciliation results)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_discrepancies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL,
  asset_type      TEXT         NOT NULL CHECK (asset_type IN ('coins', 'stars')),
  ledger_sum      BIGINT       NOT NULL,
  wallet_balance  BIGINT       NOT NULL,
  detected_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved        BOOLEAN      NOT NULL DEFAULT FALSE,
  resolved_at     TIMESTAMPTZ  NULL,
  notes           TEXT         NULL,

  CONSTRAINT uq_audit_discrepancy_user_asset
    UNIQUE (user_id, asset_type)
);

CREATE INDEX IF NOT EXISTS idx_audit_discrepancies_unresolved
  ON audit_discrepancies (detected_at)
  WHERE resolved = FALSE;
