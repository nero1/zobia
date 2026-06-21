-- TASK-15: Create ledger archive tables for data retention
-- Archive tables mirror source table columns without FK constraints.
-- The CRON route /api/cron/archive-ledgers moves rows older than 180 days
-- (configurable via x_manifest ledger_archive_days) into these tables.
-- fillfactor=100 since archive rows are never updated after insert.

CREATE TABLE IF NOT EXISTS coin_ledger_archive (
  id               UUID NOT NULL,
  user_id          UUID NOT NULL,
  amount           BIGINT NOT NULL,
  balance_before   BIGINT NOT NULL,
  balance_after    BIGINT NOT NULL,
  transaction_type TEXT NOT NULL,
  reference_id     TEXT,
  description      TEXT,
  metadata         JSONB,
  created_at       TIMESTAMPTZ,
  archived_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
) WITH (fillfactor = 100);

CREATE INDEX IF NOT EXISTS idx_coin_ledger_archive_user
  ON coin_ledger_archive (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS star_ledger_archive (
  id               UUID NOT NULL,
  user_id          UUID NOT NULL,
  amount           BIGINT NOT NULL,
  balance_before   BIGINT NOT NULL DEFAULT 0,
  balance_after    BIGINT NOT NULL DEFAULT 0,
  transaction_type TEXT NOT NULL,
  description      TEXT,
  reference_id     TEXT,
  created_at       TIMESTAMPTZ,
  archived_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
) WITH (fillfactor = 100);

CREATE INDEX IF NOT EXISTS idx_star_ledger_archive_user
  ON star_ledger_archive (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS xp_ledger_archive (
  id            UUID NOT NULL,
  user_id       UUID NOT NULL,
  amount        INTEGER NOT NULL,
  track         TEXT NOT NULL DEFAULT 'main',
  source        TEXT NOT NULL,
  reference_id  TEXT,
  base_amount   INTEGER NOT NULL,
  created_at    TIMESTAMPTZ,
  archived_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
) WITH (fillfactor = 100);

CREATE INDEX IF NOT EXISTS idx_xp_ledger_archive_user
  ON xp_ledger_archive (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS xp_events_archive (
  id          UUID NOT NULL,
  user_id     UUID NOT NULL,
  action      TEXT NOT NULL,
  xp_awarded  INTEGER NOT NULL,
  track       TEXT NOT NULL DEFAULT 'main',
  metadata    JSONB,
  created_at  TIMESTAMPTZ,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) WITH (fillfactor = 100);

CREATE INDEX IF NOT EXISTS idx_xp_events_archive_user
  ON xp_events_archive (user_id, created_at DESC);
