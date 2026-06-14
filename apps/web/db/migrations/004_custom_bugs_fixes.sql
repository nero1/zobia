-- Migration 004: Custom bug fixes schema changes
-- BUG-EC02: Atomic first-gift XP tracking
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_gift_received_xp_awarded BOOLEAN DEFAULT FALSE;

-- BUG-CR01: Leaderboard rank tracking for rank-change notifications
ALTER TABLE leaderboard_snapshots ADD COLUMN IF NOT EXISTS last_notified_rank INTEGER;

-- BUG-GW01: Prevent TOCTOU race in guild war matchmaking
CREATE UNIQUE INDEX IF NOT EXISTS idx_guild_wars_defender_active
  ON guild_wars (defender_guild_id)
  WHERE status IN ('active', 'final_hour');
