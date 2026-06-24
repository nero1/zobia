-- Migration 0030: Custom bug fixes (BUG-003, 004, 007, 010, 019, 020, 021)
--
-- BUG-003: failed_commissions.amount_kobo — widen from integer to bigint
-- BUG-004: gifts.coin_value / gifts.coin_cost — widen from integer to bigint
-- BUG-007: user_xp_boosters.multiplier — change from decimal(4,2) to integer basis points
-- BUG-010: push_tickets — add partial index for faster unresolved-ticket queries
-- BUG-019: rooms — functional unique index on season_ceremony_id metadata key
-- BUG-020: dm_conversations — ensure canonical pair ordering (user_id_1 < user_id_2)
-- BUG-021: moderation_reports.reported_message_id — add FK with ON DELETE SET NULL

-- ---------------------------------------------------------------------------
-- BUG-003: failed_commissions.amount_kobo — bigint
-- ---------------------------------------------------------------------------
ALTER TABLE failed_commissions
  ALTER COLUMN amount_kobo TYPE BIGINT USING amount_kobo::BIGINT;

-- ---------------------------------------------------------------------------
-- BUG-004: gifts.coin_value / gifts.coin_cost — bigint
-- ---------------------------------------------------------------------------
ALTER TABLE gifts
  ALTER COLUMN coin_value TYPE BIGINT USING coin_value::BIGINT,
  ALTER COLUMN coin_cost  TYPE BIGINT USING coin_cost::BIGINT;

-- ---------------------------------------------------------------------------
-- BUG-007: user_xp_boosters.multiplier — decimal → integer basis points (100 = 1.0×)
-- Existing rows: ROUND(multiplier * 100) converts 2.00 → 200, 1.50 → 150, etc.
-- Default changes from "2.0" (decimal) to 200 (integer basis points).
-- ---------------------------------------------------------------------------
ALTER TABLE user_xp_boosters
  ALTER COLUMN multiplier TYPE INTEGER USING ROUND(multiplier * 100)::INTEGER;

ALTER TABLE user_xp_boosters
  ALTER COLUMN multiplier SET DEFAULT 200;

-- ---------------------------------------------------------------------------
-- BUG-010: push_tickets — partial index on unresolved tickets for faster CRON queries
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS push_tickets_unresolved_idx
  ON push_tickets (created_at ASC)
  WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- BUG-019: rooms — functional unique index on season_ceremony_id in metadata JSONB
-- Prevents two rooms being created for the same season ceremony.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS rooms_season_ceremony_id_unique
  ON rooms ((metadata->>'season_ceremony_id'))
  WHERE metadata->>'season_ceremony_id' IS NOT NULL;

-- ---------------------------------------------------------------------------
-- BUG-020: dm_conversations — enforce canonical pair ordering (user_id_1 < user_id_2)
-- All existing rows must satisfy user_id_1 < user_id_2 before adding this constraint.
-- The UPDATE swaps user_id_1 / user_id_2 for any rows where the invariant is violated.
-- Note: also swap message_count and last_message_at if stored per-column; here they
-- are pair-level, so no column swap is needed.
-- ---------------------------------------------------------------------------
UPDATE dm_conversations
  SET user_id_1 = user_id_2,
      user_id_2 = user_id_1
WHERE user_id_1 > user_id_2;

-- Add a CHECK constraint so future inserts always satisfy user_id_1 < user_id_2.
-- The application helper canonicalDmPair() must be used before every INSERT/SELECT.
ALTER TABLE dm_conversations
  ADD CONSTRAINT dm_canonical_pair CHECK (user_id_1 < user_id_2);

-- ---------------------------------------------------------------------------
-- BUG-021: moderation_reports.reported_message_id — add FK with ON DELETE SET NULL
-- First, clean up any dangling references to deleted messages.
-- ---------------------------------------------------------------------------
UPDATE moderation_reports
  SET reported_message_id = NULL
  WHERE reported_message_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM room_messages rm WHERE rm.id = moderation_reports.reported_message_id
    );

ALTER TABLE moderation_reports
  ADD CONSTRAINT moderation_reports_reported_message_id_fkey
    FOREIGN KEY (reported_message_id)
    REFERENCES room_messages (id)
    ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- BUG-022: user_quest_progress — non-negative progress_count constraint
-- Guards against negative values accumulating due to concurrent or erroneous
-- decrement calls. The application layer already validates increment > 0, but
-- a DB CHECK is the last line of defence.
-- ---------------------------------------------------------------------------
ALTER TABLE user_quest_progress
  ADD CONSTRAINT chk_progress_nonneg CHECK (progress_count >= 0);
