-- 0010_gift_type_fk.sql
--
-- BUG-SCHEMA-04: Wire gift_types into the gifts table.
--
-- gift_types was introduced as a second catalogue (migration 011 in the internal
-- sequence) but gifts.gift_item_id still pointed only at the legacy gift_items
-- table, leaving gift_types as an orphaned, unreachable catalogue.
--
-- Migration path (documented in schema.ts TODO):
--   Phase 1 (this file): add nullable gift_type_id FK and backfill existing rows.
--   Phase 2 (follow-up):  make gift_type_id NOT NULL, drop gift_item_id.
--
-- The backfill joins gift_items → gift_types by name. Rows with no matching
-- gift_type (name not yet in gift_types) are left NULL — that is intentional
-- and safe while the column is still nullable.
--
-- Check for unmatched rows after applying:
--   SELECT COUNT(*) FROM gifts WHERE gift_type_id IS NULL;
-- Ensure that count reaches 0 before the Phase 2 NOT NULL migration.
--
-- Idempotent: IF NOT EXISTS guards make re-running safe.

BEGIN;

ALTER TABLE gifts
  ADD COLUMN IF NOT EXISTS gift_type_id UUID
    REFERENCES gift_types(id) ON DELETE RESTRICT;

-- Backfill: match via gift_items.name = gift_types.name
UPDATE gifts g
SET    gift_type_id = gt.id
FROM   gift_items gi
JOIN   gift_types gt ON gt.name = gi.name
WHERE  g.gift_item_id = gi.id
  AND  g.gift_type_id IS NULL;

CREATE INDEX IF NOT EXISTS gifts_gift_type_id_idx ON gifts (gift_type_id);

COMMIT;
