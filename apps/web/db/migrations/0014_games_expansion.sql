-- =====================================================================
-- 0014_games_expansion.sql
--
-- Games Expansion: ratings, new categories, ad-toggle flag, and 20
-- new game seeds.
--
-- All statements are idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Add avg_rating + rating_count columns to games for fast reads.
--    A separate game_ratings table stores individual user ratings.
-- ---------------------------------------------------------------------
ALTER TABLE games ADD COLUMN IF NOT EXISTS avg_rating    numeric(3,2) NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS rating_count  integer NOT NULL DEFAULT 0;

-- game_ratings: one row per (game, user). Aggregate is updated on write.
CREATE TABLE IF NOT EXISTS game_ratings (
  game_id    uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, user_id)
);

CREATE INDEX IF NOT EXISTS game_ratings_game_idx ON game_ratings (game_id);

-- ---------------------------------------------------------------------
-- 2. Manifest flags for ads toggle per placement and trending window.
-- ---------------------------------------------------------------------
INSERT INTO x_manifest (key, value, description) VALUES
  ('game_ads_enabled',           'true',  'Master toggle for ads on game pages (cover + play).'),
  ('game_ads_directory_enabled', 'true',  'Toggle for ads on the games directory page.'),
  ('game_trending_hours',        '72',    'Window in hours for computing trending play counts.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Seed the 20 new games. Idempotent on slug.
-- ---------------------------------------------------------------------

-- TAP GAMES
INSERT INTO games
  (slug, name, tagline, description, long_description, cover_emoji, category, engine_key,
   sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win,
   play_cost_credits, play_cost_stars, max_score, min_play_seconds, is_public, is_active)
VALUES
  ('tap-frenzy', 'Tap Frenzy', 'How fast can you tap?',
   'Tap the screen as fast as you can before time runs out.',
   'Pure speed — tap as many times as you can in 15 seconds. Track your record, challenge your friends, and see who has the fastest fingers on Zobia.',
   '👆', 'Tap', 'tapFrenzy', 1, 30, 25, 0, 0, 0, 9999, 10, TRUE, TRUE),

  ('bubble-burst', 'Bubble Burst', 'Pop before they escape!',
   'Tap coloured bubbles before they float off the screen.',
   'Coloured bubbles rise from below. Tap them to pop them before they escape off the top! Miss too many and it is game over. The bubbles get faster and faster — how long can you keep up?',
   '🫧', 'Tap', 'bubbleBurst', 2, 35, 28, 0, 0, 0, 9999999, 10, TRUE, TRUE),

  ('reaction-rush', 'Reaction Rush', 'Tap the moment you see green!',
   'Test your reaction time — tap as soon as the target turns green.',
   'A pure reaction-time test. Wait for the circle to flash green and tap as fast as you can. Your reaction time is measured in milliseconds. The average human takes 250 ms — can you beat that?',
   '⚡', 'Tap', 'reactionRush', 3, 30, 25, 0, 0, 0, 9999, 5, TRUE, TRUE),

  ('color-tap', 'Color Tap', 'Tap only the right colour!',
   'Tap the matching colour tile as fast as possible.',
   'A colour — name is shown at the top. Tap the tile that matches the colour shown, not the colour of the text. Simple to understand, surprisingly tricky to execute fast. How many correct taps before you slip up?',
   '🎨', 'Tap', 'colorTap', 4, 35, 28, 0, 0, 0, 9999, 10, TRUE, TRUE),

-- ARCADE GAMES
  ('flappy-duck', 'Flappy Duck', 'Flap through the pipes!',
   'Tap to flap your wings and weave through pipe gaps.',
   'Guide your cheerful duck through an endless series of pipe gaps. Tap to flap — let go and you fall. Time your taps perfectly to thread each gap. One touch of the pipes and it is all over.',
   '🦆', 'Arcade', 'flappyDuck', 3, 50, 40, 0, 0, 0, 9999, 5, TRUE, TRUE),

  ('stack-tower', 'Stack Tower', 'Drop, stack, keep going!',
   'Drop falling blocks and stack them as high as you can.',
   'A block swings back and forth on a platform. Tap to drop it and land it on the stack below. The more accurately you land it, the bigger the block stays. Miss and it shrinks. How high can you build before the block vanishes entirely?',
   '🏗️', 'Arcade', 'stackTower', 4, 45, 38, 0, 0, 0, 9999, 10, TRUE, TRUE),

-- IDLE GAMES
  ('cookie-kingdom', 'Cookie Kingdom', 'Click. Bake. Rule.',
   'Click to bake cookies and buy upgrades for your kingdom.',
   'Start with a single click to bake a cookie. Earn enough to buy bakeries, farms, factories and eventually entire cookie empires. Watch your cookies multiply while you are busy doing other things — the idle life is sweet.',
   '🍪', 'Idle', 'cookieKingdom', 1, 40, 35, 0, 0, 0, 9999999999, 20, TRUE, TRUE),

  ('galaxy-miner', 'Galaxy Miner', 'Mine the cosmos!',
   'Tap to mine space rocks and upgrade your fleet.',
   'Tap asteroids to extract precious minerals. Spend your haul on mining drones, laser rigs and warp drives that mine for you automatically. Build your galactic empire one asteroid at a time.',
   '⛏️', 'Idle', 'galaxyMiner', 2, 40, 35, 0, 0, 0, 9999999999, 20, TRUE, TRUE),

-- PUZZLE GAMES
  ('memory-match', 'Memory Match', 'Find every pair!',
   'Flip cards to reveal matching pairs.',
   'A grid of face-down cards is shuffled. Flip two at a time — if they match, they stay face up; if not, they flip back. Clear the board in as few moves as possible. Your score is based on speed and how few mismatches you make.',
   '🃏', 'Puzzle', 'memoryMatch', 3, 45, 38, 0, 0, 0, 9999, 10, TRUE, TRUE),

  ('slide-puzzle', 'Slide Puzzle', 'Slide the tiles into order!',
   'Rearrange the numbered tiles to put them in order.',
   'A classic 4×4 sliding puzzle. Slide the numbered tiles through the single empty space to arrange them in order from 1–15. Minimal moves, minimal time — the best solvers complete it in seconds.',
   '🔢', 'Puzzle', 'slidePuzzle', 4, 40, 35, 0, 0, 0, 9999, 10, TRUE, TRUE),

  ('minesweeper', 'Minesweeper', 'Avoid the mines!',
   'Reveal the grid but do not hit any hidden mines.',
   'Reveal the grid square by square using the number clues — each number tells you how many mines touch that square. Flag the mines and clear everything else to win. One wrong click and it is over.',
   '💣', 'Puzzle', 'minesweeper', 5, 50, 40, 0, 0, 0, 9999, 10, TRUE, TRUE),

  ('color-sort', 'Color Sort', 'Sort the colours into their tubes!',
   'Move coloured balls to fill each tube with one colour.',
   'Test tubes contain a mixed jumble of coloured balls. Move balls between tubes (only onto matching colours or into empty tubes) until every tube holds one pure colour. Each solved level reveals a harder arrangement.',
   '🎨', 'Puzzle', 'colorSort', 6, 45, 38, 0, 0, 0, 9999, 10, TRUE, TRUE),

-- CARD GAMES
  ('blackjack', 'Blackjack', 'Beat the dealer to 21!',
   'Play classic Blackjack against the AI dealer.',
   'The classic casino card game. Try to build a hand closer to 21 than the dealer without going bust. Hit, stand, or double down — make the right call at the right moment and rake in the chips.',
   '🃏', 'Card', 'blackjack', 1, 55, 45, 0, 0, 0, 9999, 10, TRUE, TRUE),

  ('whot', 'Whot!', 'Play your cards right!',
   'Play the popular African card game against the AI.',
   'The beloved West African card game. Match cards by number or suit, play special action cards, and race to clear your hand before the AI beats you. Calls of "Whot!" are the sweetest sound on the table.',
   '🎴', 'Card', 'whot', 2, 55, 45, 0, 0, 0, 9999, 15, TRUE, TRUE),

  ('higher-or-lower', 'Higher or Lower', 'Is the next card higher or lower?',
   'Guess whether the next playing card will be higher or lower.',
   'A card is revealed. Guess whether the next card will be higher or lower. Get it right and keep your streak going. One wrong guess ends the run. Cards do not repeat — use your memory!',
   '🎴', 'Card', 'higherOrLower', 3, 35, 28, 0, 0, 0, 9999, 5, TRUE, TRUE),

-- BOARD GAMES
  ('chess', 'Chess', 'The classic game of kings.',
   'Play Chess against the AI at your own pace.',
   'The timeless game of strategy and tactics. Play against the AI — choose Easy for a relaxed game or Hard for a genuine challenge. Capture the opponent''s king to win.',
   '♟️', 'Board', 'chess', 1, 70, 60, 1, 0, 0, 9999, 30, TRUE, TRUE),

  ('ludo', 'Ludo', 'Race your pieces home!',
   'Play Ludo against AI opponents — roll dice and race home.',
   'The classic race board game. Roll the dice and race all four of your pieces from start to home base before your AI opponents do. Land on an opponent''s piece to send it back to the start!',
   '🎲', 'Board', 'ludo', 2, 65, 55, 0, 0, 0, 9999, 30, TRUE, TRUE),

-- WORD GAMES
  ('word-scramble', 'Word Scramble', 'Unscramble the letters!',
   'Unscramble jumbled letters to spell the hidden word.',
   'A word appears with all its letters scrambled. Rearrange them to reveal the correct word before the timer runs out. Five words per round — the faster and more accurately you solve them, the higher your score.',
   '🔤', 'Word', 'wordScramble', 1, 40, 35, 0, 0, 0, 9999, 10, TRUE, TRUE),

  ('simon-says', 'Simon Says', 'Remember the sequence!',
   'Watch the colour pattern and repeat it back.',
   'A sequence of coloured tiles lights up. Watch carefully, then repeat the pattern in the same order. Each successful round adds one more step to the sequence. How far can your memory take you?',
   '🌈', 'Word', 'simonSays', 2, 40, 35, 0, 0, 0, 9999, 10, TRUE, TRUE),

-- CASUAL
  ('rock-paper-scissors', 'Rock Paper Scissors', 'Best of 5 vs the AI!',
   'Play Rock Paper Scissors in rapid best-of-5 rounds.',
   'You already know the rules. Play fast best-of-5 rounds against the AI. The AI has a subtle pattern — can you crack it and outsmart the machine? First to 3 wins takes the match.',
   '✊', 'Casual', 'rockPaperScissors', 1, 30, 25, 0, 0, 0, 9999, 10, TRUE, TRUE)

ON CONFLICT (slug) DO NOTHING;

-- Fix the memory-match insert (engine_key was in wrong position above — defensive update)
UPDATE games SET engine_key = 'memoryMatch', category = 'Puzzle'
  WHERE slug = 'memory-match' AND engine_key IS NULL;
