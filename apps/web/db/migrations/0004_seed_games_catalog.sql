-- ---------------------------------------------------------------------------
-- Seed the built-in games catalogue.
--
-- Every engine listed in shared/utils/games.ts (GAME_REGISTRY) and registered
-- in apps/web/components/games/engineRegistry.ts already ships a working
-- client engine, but no migration ever inserted the matching `games` catalog
-- rows -- so /games, /games/challenges and /g/<slug> all rendered empty
-- (games.repo queries filter on real rows; there were none). This migration
-- seeds one row per built-in engine so the directory is populated on a fresh
-- database. Existing rows (e.g. hand-added by an admin) are left untouched.
-- ---------------------------------------------------------------------------

INSERT INTO games (slug, name, category, engine_key, cover_emoji, sort_order) VALUES
  -- Original 6
  ('tetris',               'Zobia Tetris',        'Puzzle',   'tetris',            '🧩', 0),
  ('2048',                 '2048',                 'Puzzle',   'g2048',             '🔢', 1),
  ('car-racing',           'Speed Dodge',          'Action',   'carRacing',         '🏎️', 0),
  ('space-shooter',        'Star Blaster',         'Action',   'spaceShooter',      '🚀', 1),
  ('snake',                'Zobia Snake',          'Arcade',   'snake',             '🐍', 0),
  ('breakout',             'Brick Buster',         'Arcade',   'breakout',          '🧱', 1),
  -- Tap
  ('tap-frenzy',           'Tap Frenzy',           'Tap',      'tapFrenzy',         '👆', 0),
  ('bubble-burst',         'Bubble Burst',         'Tap',      'bubbleBurst',       '🫧', 1),
  ('reaction-rush',        'Reaction Rush',        'Tap',      'reactionRush',      '⚡', 2),
  ('color-tap',            'Color Tap',            'Tap',      'colorTap',          '🎨', 3),
  -- Arcade
  ('flappy-duck',          'Flappy Duck',          'Arcade',   'flappyDuck',        '🦆', 2),
  ('stack-tower',          'Stack Tower',          'Arcade',   'stackTower',        '🏗️', 3),
  -- Idle
  ('cookie-kingdom',       'Cookie Kingdom',       'Idle',     'cookieKingdom',     '🍪', 0),
  ('galaxy-miner',         'Galaxy Miner',         'Idle',     'galaxyMiner',       '⛏️', 1),
  -- Puzzle
  ('memory-match',         'Memory Match',         'Puzzle',   'memoryMatch',       '🃏', 2),
  ('slide-puzzle',         'Slide Puzzle',         'Puzzle',   'slidePuzzle',       '🔢', 3),
  ('minesweeper',          'Minesweeper',          'Puzzle',   'minesweeper',       '💣', 4),
  ('color-sort',           'Color Sort',           'Puzzle',   'colorSort',         '🎨', 5),
  -- Card
  ('blackjack',            'Blackjack',            'Card',     'blackjack',         '🃏', 0),
  ('whot',                 'Whot!',                'Card',     'whot',              '🎴', 1),
  ('higher-or-lower',      'Higher or Lower',      'Card',     'higherOrLower',     '🎴', 2),
  -- Board
  ('chess',                'Chess',                'Board',    'chess',             '♟️', 0),
  ('ludo',                 'Ludo',                 'Board',    'ludo',              '🎲', 1),
  -- Word
  ('word-scramble',        'Word Scramble',        'Word',     'wordScramble',      '🔤', 0),
  ('simon-says',           'Simon Says',           'Word',     'simonSays',         '🌈', 1),
  -- Casual
  ('rock-paper-scissors',  'Rock Paper Scissors',  'Casual',   'rockPaperScissors', '✊', 0),

  -- Expansion: 30 new games
  -- Puzzle (8 new)
  ('sudoku',               'Sudoku',               'Puzzle',   'sudoku',           '🔢', 6),
  ('word-search',          'Word Search',          'Puzzle',   'wordSearch',       '🔍', 7),
  ('lights-out',           'Lights Out',           'Puzzle',   'lightsOut',        '💡', 8),
  ('number-match',         'Number Match',         'Puzzle',   'numberMatch',      '🔟', 9),
  ('nonogram',             'Nonogram',             'Puzzle',   'nonogram',         '🖼️', 10),
  ('pipe-connect',         'Pipe Connect',         'Puzzle',   'pipeConnect',      '🔧', 11),
  ('sliding-blocks',       'Sliding Blocks',       'Puzzle',   'slidingBlocks',    '🧩', 12),
  ('mahjong',              'Mahjong Solitaire',    'Puzzle',   'mahjongSolitaire', '🀄', 13),
  -- Action (2 new)
  ('whack-a-mole',         'Whack-a-Mole',         'Action',   'whackAMole',       '🔨', 2),
  ('fruit-slicer',         'Fruit Slicer',         'Action',   'fruitSlicer',      '🍎', 3),
  -- Board (1 new)
  ('ayo',                  'Ayo',                  'Board',    'ayo',              '🏺', 2),
  -- Arcade (3 new)
  ('platform-jumper',      'Platform Jumper',      'Arcade',   'platformJumper',   '🦘', 4),
  ('pixel-runner',         'Pixel Runner',         'Arcade',   'pixelRunner',      '🏃', 5),
  ('asteroid-dodge',       'Asteroid Dodge',       'Arcade',   'asteroidDodge',    '☄️', 6),
  -- Tap (2 new)
  ('speed-tap',            'Speed Tap',            'Tap',      'speedTap',         '🎯', 4),
  ('color-rain',           'Color Rain',           'Tap',      'colorRain',        '🌈', 5),
  -- Trivia (4 new — new category)
  ('quick-quiz',           'Quick Quiz',           'Trivia',   'quickQuiz',        '🧠', 0),
  ('true-or-false',        'True or False',        'Trivia',   'trueOrFalse',      '✅', 1),
  ('emoji-quiz',           'Emoji Quiz',           'Trivia',   'emojiQuiz',        '😎', 2),
  ('flag-quiz',            'Flag Quiz',            'Trivia',   'flagQuiz',         '🚩', 3),
  -- Word (3 new)
  ('word-guess',           'Word Guess',           'Word',     'wordGuess',        '💬', 2),
  ('hangman',              'Hangman',              'Word',     'hangman',          '🎭', 3),
  ('anagram-rush',         'Anagram Rush',         'Word',     'anagramRush',      '🔀', 4),
  -- Casual (2 new)
  ('tic-tac-toe',          'Tic Tac Toe',          'Casual',   'ticTacToe',        '⭕', 1),
  ('connect-four',         'Connect Four',         'Casual',   'connectFour',      '🔴', 2),
  -- Strategy (2 new — new category)
  ('gem-swap',             'Gem Swap',             'Strategy', 'gemSwap',          '💎', 0),
  ('dots-and-boxes',       'Dots & Boxes',         'Strategy', 'dotsAndBoxes',     '📦', 1),
  -- Sports (2 new — new category)
  ('penalty-kick',         'Penalty Kick',         'Sports',   'penaltyKick',      '⚽', 0),
  ('basketball-shot',      'Basketball Shot',      'Sports',   'basketballShot',   '🏀', 1),
  -- Music (1 new — new category)
  ('beat-tap',             'Beat Tap',             'Music',    'beatTap',          '🎵', 0)
ON CONFLICT (slug) DO NOTHING;
