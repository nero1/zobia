-- =====================================================================
-- 0013_games_feature.sql
--
-- Games / Gaming feature.
--
-- Builds on the `games` table created in 0012 (slug-addressed at /g/<slug>).
-- Adds: per-game cover/reward/play-cost config, a gaming progression track
-- (xp_gaming / level_gaming on users — mirrors the existing six tracks), play
-- sessions + best-score leaderboards, user-vs-user challenges (best of 1 or 3,
-- optional credit wager with escrow), and global games-played milestones.
--
-- All statements are idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING) so the
-- migration is safe to re-run and never clobbers admin overrides or live data.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Extend the games table with cover-page, reward and play-cost config.
--    `engine_key` maps a row to its client engine module (see
--    shared/games/registry.ts). `category` is one of the static categories
--    defined in that registry (Puzzle / Action / Arcade).
-- ---------------------------------------------------------------------
ALTER TABLE games ADD COLUMN IF NOT EXISTS category               text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS long_description       text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS engine_key             text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS sort_order             integer NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS reward_credits_per_win integer NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS reward_xp_per_win      integer NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS reward_stars_per_win   integer NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS play_cost_credits      integer NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS play_cost_stars        integer NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS max_score              bigint;
ALTER TABLE games ADD COLUMN IF NOT EXISTS min_play_seconds       integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS games_category_active_idx
  ON games (category, sort_order)
  WHERE deleted_at IS NULL AND is_active = TRUE;

-- ---------------------------------------------------------------------
-- 2. Gaming progression track on users — mirrors xp_social / level_social etc.
-- ---------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS xp_gaming    integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS level_gaming integer NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------
-- 3. Play sessions. One row per started game session; the server issues a
--    single-use nonce on /start and consumes it on /score (anti-replay).
--    `counted` flags a session whose score was accepted and rewarded.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_plays (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id            uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score              bigint NOT NULL DEFAULT 0,
  session_nonce      text NOT NULL,
  counted            boolean NOT NULL DEFAULT FALSE,
  challenge_round_id uuid,
  started_at         timestamptz NOT NULL DEFAULT NOW(),
  ended_at           timestamptz
);

CREATE INDEX IF NOT EXISTS game_plays_game_idx ON game_plays (game_id, ended_at);
CREATE INDEX IF NOT EXISTS game_plays_user_idx ON game_plays (user_id, ended_at);
CREATE UNIQUE INDEX IF NOT EXISTS game_plays_nonce_idx ON game_plays (session_nonce);

-- ---------------------------------------------------------------------
-- 4. Per-(game,user) best score + counters. Backs the per-game leaderboard
--    with a plain ORDER BY (wrapped by a short Redis cache in app code).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_best_scores (
  game_id    uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  best_score bigint NOT NULL DEFAULT 0,
  plays      integer NOT NULL DEFAULT 0,
  wins       integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, user_id)
);

CREATE INDEX IF NOT EXISTS game_best_scores_leaderboard_idx
  ON game_best_scores (game_id, best_score DESC);

-- ---------------------------------------------------------------------
-- 5. Challenges (async score-based). A challenger invites an opponent to play
--    a game best-of-1 or best-of-3. Optional credit wager is escrowed on
--    accept and paid to the winner (minus rake) on completion.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_challenges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id        uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  challenger_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opponent_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','accepted','declined','active','completed','cancelled','expired')),
  rounds         integer NOT NULL DEFAULT 1 CHECK (rounds IN (1,3)),
  wager_credits  integer NOT NULL DEFAULT 0 CHECK (wager_credits >= 0),
  escrow_credits integer NOT NULL DEFAULT 0,
  winner_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  prize_credits  integer NOT NULL DEFAULT 0,
  prize_xp       integer NOT NULL DEFAULT 0,
  prize_stars    integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT NOW(),
  expires_at     timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
  completed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS game_challenges_opponent_idx ON game_challenges (opponent_id, status);
CREATE INDEX IF NOT EXISTS game_challenges_challenger_idx ON game_challenges (challenger_id, status);
CREATE INDEX IF NOT EXISTS game_challenges_expiry_idx ON game_challenges (status, expires_at);

CREATE TABLE IF NOT EXISTS game_challenge_rounds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id       uuid NOT NULL REFERENCES game_challenges(id) ON DELETE CASCADE,
  round_no           integer NOT NULL,
  challenger_play_id uuid REFERENCES game_plays(id) ON DELETE SET NULL,
  opponent_play_id   uuid REFERENCES game_plays(id) ON DELETE SET NULL,
  challenger_score   bigint,
  opponent_score     bigint,
  round_winner_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','complete')),
  UNIQUE (challenge_id, round_no)
);

CREATE INDEX IF NOT EXISTS game_challenge_rounds_challenge_idx
  ON game_challenge_rounds (challenge_id, round_no);

-- ---------------------------------------------------------------------
-- 6. Global "games played" milestones (gaming track). Admin-configurable.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_play_milestones (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  games_played_threshold   integer NOT NULL UNIQUE,
  reward_credits           integer NOT NULL DEFAULT 0,
  reward_xp                integer NOT NULL DEFAULT 0,
  reward_stars             integer NOT NULL DEFAULT 0,
  is_active                boolean NOT NULL DEFAULT TRUE,
  created_at               timestamptz NOT NULL DEFAULT NOW()
);

-- Track which milestones a user has already claimed (idempotent awards).
CREATE TABLE IF NOT EXISTS game_milestone_claims (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  threshold    integer NOT NULL,
  claimed_at   timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, threshold)
);

-- ---------------------------------------------------------------------
-- 6b. Ensure the games slug index is a full unique index (not partial) so
--     ON CONFLICT (slug) below can reference it. Migration 0012 created a
--     partial index; replace it with an unconditional one if needed.
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS games_slug_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS games_slug_unique_idx ON games (slug);

-- ---------------------------------------------------------------------
-- 7. Seed the six launch games (3 categories x 2). Idempotent on slug.
--    Display fields here are admin-editable later via /admin/games.
-- ---------------------------------------------------------------------
INSERT INTO games
  (slug, name, tagline, description, long_description, cover_emoji, category, engine_key,
   sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win,
   play_cost_credits, play_cost_stars, max_score, min_play_seconds, is_public, is_active)
VALUES
  ('tetris', 'Zobia Tetris', 'Stack, clear, survive.',
   'Classic falling-blocks puzzle. Clear lines to score.',
   'The timeless falling-blocks puzzle. Rotate and drop tetrominoes to complete horizontal lines. The more lines you clear at once, the bigger the score. How long can you last as the blocks speed up?',
   '🧩', 'Puzzle', 'tetris', 1, 50, 40, 0, 0, 0, 9999999, 5, TRUE, TRUE),

  ('2048', '2048', 'Merge to the magic number.',
   'Slide tiles and merge matching numbers to reach 2048.',
   'Slide numbered tiles on a grid; when two tiles with the same number touch they merge into one. Combine them to reach the 2048 tile — and keep going for a high score.',
   '🔢', 'Puzzle', 'g2048', 2, 50, 40, 0, 0, 0, 9999999, 5, TRUE, TRUE),

  ('car-racing', 'Speed Dodge', 'Weave through traffic.',
   'Dodge oncoming cars and survive as long as you can.',
   'A fast lane-dodging racer. Steer left and right to weave through endless oncoming traffic. The longer you survive and the faster you go, the higher your score.',
   '🏎️', 'Action', 'carRacing', 1, 60, 50, 0, 0, 0, 9999999, 5, TRUE, TRUE),

  ('space-shooter', 'Star Blaster', 'Blast the asteroid field.',
   'Pilot a ship and shoot down waves of asteroids.',
   'An arcade space shooter. Pilot your ship through an endless asteroid field, blasting rocks and dodging debris. Chain kills to rack up a high score.',
   '🚀', 'Action', 'spaceShooter', 2, 60, 50, 0, 0, 0, 9999999, 5, TRUE, TRUE),

  ('snake', 'Zobia Snake', 'Eat, grow, do not bite yourself.',
   'Guide the snake to eat and grow without crashing.',
   'The classic snake game. Guide your ever-growing snake to eat food while avoiding the walls and your own tail. Each bite makes you longer — and the game harder.',
   '🐍', 'Arcade', 'snake', 1, 40, 35, 0, 0, 0, 9999999, 5, TRUE, TRUE),

  ('breakout', 'Brick Buster', 'Smash every brick.',
   'Bounce the ball to break all the bricks.',
   'A brick-breaking arcade classic. Move the paddle to bounce the ball and smash every brick on the screen. Do not let the ball fall — clear the board for the highest score.',
   '🧱', 'Arcade', 'breakout', 2, 40, 35, 0, 0, 0, 9999999, 5, TRUE, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- Backfill engine_key/category for any pre-existing seed rows that predate
-- this migration but match a known slug (defensive; no-op on fresh installs).
UPDATE games SET engine_key = 'tetris',       category = 'Puzzle' WHERE slug = 'tetris'        AND engine_key IS NULL;
UPDATE games SET engine_key = 'g2048',        category = 'Puzzle' WHERE slug = '2048'          AND engine_key IS NULL;
UPDATE games SET engine_key = 'carRacing',    category = 'Action' WHERE slug = 'car-racing'    AND engine_key IS NULL;
UPDATE games SET engine_key = 'spaceShooter', category = 'Action' WHERE slug = 'space-shooter' AND engine_key IS NULL;
UPDATE games SET engine_key = 'snake',        category = 'Arcade' WHERE slug = 'snake'         AND engine_key IS NULL;
UPDATE games SET engine_key = 'breakout',     category = 'Arcade' WHERE slug = 'breakout'      AND engine_key IS NULL;

-- ---------------------------------------------------------------------
-- 8. Seed games-played milestones (gaming track). Admin-editable.
-- ---------------------------------------------------------------------
INSERT INTO game_play_milestones (games_played_threshold, reward_credits, reward_xp, reward_stars)
VALUES
  (10,   100,  200, 0),
  (50,   500,  600, 1),
  (100,  1200, 1500, 3),
  (500,  6000, 8000, 10)
ON CONFLICT (games_played_threshold) DO NOTHING;

-- ---------------------------------------------------------------------
-- 9. Seed manifest keys (admin-editable at /admin/feature-flags & /admin/config).
--    The manifest loader falls back to the same defaults when a row is absent,
--    so these rows exist purely to surface the keys in the admin UI.
-- ---------------------------------------------------------------------
INSERT INTO x_manifest (key, value, description) VALUES
  ('feature_games',                'true', 'Master switch for the Games feature (directory, /g pages, challenges).'),
  ('game_wager_rake_pct',          '5',    'Platform rake percentage taken from a challenge wager pot before payout.'),
  ('game_challenge_expiry_hours',  '48',   'Hours a pending/active challenge stays open before it expires.'),
  ('game_default_reward_credits',  '50',   'Fallback credits awarded for a game win when a game sets 0.'),
  ('game_default_reward_xp',       '40',   'Fallback gaming XP awarded for a game win when a game sets 0.')
ON CONFLICT (key) DO NOTHING;
