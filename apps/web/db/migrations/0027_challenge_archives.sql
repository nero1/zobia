BEGIN;
ALTER TABLE game_challenges ADD COLUMN IF NOT EXISTS challenger_archived_at timestamptz;
ALTER TABLE game_challenges ADD COLUMN IF NOT EXISTS opponent_archived_at timestamptz;
UPDATE game_challenges SET challenger_archived_at=archived_at, opponent_archived_at=archived_at
WHERE archived_at IS NOT NULL AND challenger_archived_at IS NULL AND opponent_archived_at IS NULL;
COMMIT;
