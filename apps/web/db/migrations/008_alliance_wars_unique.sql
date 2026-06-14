-- 008_alliance_wars_unique.sql
-- Adds a unique partial index on alliance_wars to prevent duplicate active wars
-- between the same pair of alliances. Uses a canonical ordering (smaller UUID first)
-- so (A, B) and (B, A) are treated as the same pair.

CREATE UNIQUE INDEX IF NOT EXISTS idx_alliance_wars_active_pair
  ON alliance_wars (
    LEAST(alliance_1_id::text, alliance_2_id::text),
    GREATEST(alliance_1_id::text, alliance_2_id::text)
  )
  WHERE status = 'active';
