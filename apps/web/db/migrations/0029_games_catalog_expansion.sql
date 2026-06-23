-- =====================================================================
-- 0029_games_catalog_expansion.sql
--
-- Games Catalog Expansion: 30 new games across 4 new categories
-- (Trivia, Strategy, Sports, Music) plus expansions of existing
-- categories (Puzzle, Action, Board, Arcade, Tap, Word, Casual).
--
-- All statements are idempotent (ON CONFLICT DO NOTHING).
-- Categories are pure text — no schema change needed.
-- =====================================================================

-- ── PUZZLE (8 new) ────────────────────────────────────────────────────
INSERT INTO games
  (slug, name, tagline, description, long_description, cover_emoji, category, engine_key,
   sort_order, reward_credits_per_win, reward_xp_per_win, reward_stars_per_win,
   play_cost_credits, play_cost_stars, max_score, min_play_seconds, is_public, is_active)
VALUES

  ('sudoku', 'Sudoku', 'Fill every row, column and box!',
   'Classic 9×9 Sudoku. Place the digits 1–9 so every row, column, and 3×3 box holds each digit exactly once.',
   'The world''s most popular logic puzzle, now on Zobia. Three difficulty levels — Easy for a relaxed solve, Hard for a real brain workout. Your score is based on how fast you complete the puzzle.',
   '🔢', 'Puzzle', 'sudoku', 7, 50, 40, 0, 0, 0, 1000, 30, TRUE, TRUE),

  ('word-search', 'Word Search', 'Find every hidden word!',
   'Scan the letter grid horizontally, vertically and diagonally to find all the hidden words.',
   'A grid packed with hidden words in every direction. Spot them all to clear the board. Words get longer and grids bigger as difficulty increases — can you find every word before time runs out?',
   '🔍', 'Puzzle', 'wordSearch', 8, 45, 38, 0, 0, 0, 2000, 20, TRUE, TRUE),

  ('lights-out', 'Lights Out', 'Toggle the lights — turn them all off!',
   'Click a cell to toggle it and its neighbours. Your goal: turn every light OFF.',
   'A deceptively simple puzzle. Each click toggles the clicked cell plus its orthogonal neighbours. Start from a scrambled state and work out which toggles to press to switch off every last light.',
   '💡', 'Puzzle', 'lightsOut', 9, 45, 38, 0, 0, 0, 500, 10, TRUE, TRUE),

  ('number-match', 'Number Match', 'Clear pairs that sum to 10!',
   'Tap two numbers that are equal or sum to 10 to remove them from the grid.',
   'A satisfying number clearing game. Match adjacent numbers — or numbers in the same row or column with nothing between them — that are equal or add up to 10. Clear the board to win!',
   '🔟', 'Puzzle', 'numberMatch', 10, 40, 35, 0, 0, 0, 9999, 15, TRUE, TRUE),

  ('nonogram', 'Nonogram', 'Fill the grid from the number clues!',
   'Use the row and column number clues to figure out which cells to fill in.',
   'Also known as Picross or Hanjie — a pixel-art logic puzzle. The numbers tell you how many consecutive filled cells appear in each row and column. Deduce the pattern and reveal the hidden picture.',
   '🖼️', 'Puzzle', 'nonogram', 11, 50, 42, 0, 0, 0, 500, 20, TRUE, TRUE),

  ('pipe-connect', 'Pipe Connect', 'Connect all the pipe endpoints!',
   'Draw pipes between matching colour endpoints so every cell is covered.',
   'Flow-free style pipe puzzle. Connect each pair of same-coloured endpoints with a continuous pipe, and fill every single cell on the grid. Pipes cannot cross. Think ahead — it gets fiendishly tricky!',
   '🔧', 'Puzzle', 'pipeConnect', 12, 50, 42, 0, 0, 0, 500, 20, TRUE, TRUE),

  ('sliding-blocks', 'Sliding Blocks', 'Slide the red block to the exit!',
   'Slide coloured blocks to clear a path for the red block to escape.',
   'Inspired by the classic Rush Hour puzzle. A grid of blocks — some horizontal, some vertical — sit between your red block and the exit. Slide them out of the way, one by one, until the red block can slide free.',
   '🧩', 'Puzzle', 'slidingBlocks', 13, 50, 42, 0, 0, 0, 500, 15, TRUE, TRUE),

  ('mahjong', 'Mahjong Solitaire', 'Match and clear all the tiles!',
   'Tap matching free tiles to remove them from the board.',
   'The beloved tile-matching solitaire. Tap two identical free tiles (not covered and with at least one open side) to remove them. Clear the entire pyramid to win. Strategy matters — remove tiles in the right order!',
   '🀄', 'Puzzle', 'mahjongSolitaire', 14, 55, 45, 0, 0, 0, 5000, 20, TRUE, TRUE),

-- ── ACTION (2 new) ────────────────────────────────────────────────────

  ('whack-a-mole', 'Whack-a-Mole', 'Bonk the moles before they hide!',
   'Tap moles the instant they pop up from their holes.',
   'Classic reaction game. Moles pop up from 9 holes at random intervals — tap them before they duck back underground! Miss too many and your score suffers. The moles get sneakier on harder difficulties.',
   '🔨', 'Action', 'whackAMole', 3, 40, 35, 0, 0, 0, 9999, 20, TRUE, TRUE),

  ('fruit-slicer', 'Fruit Slicer', 'Slice the fruit, dodge the bombs!',
   'Swipe across falling fruit to slice it, but avoid the bombs.',
   'Fruit falls from the sky — drag your finger across the screen to slice through it and rack up points. But watch out for bombs mixed in on higher difficulties! One wrong swipe and your game is over.',
   '🍎', 'Action', 'fruitSlicer', 4, 45, 38, 0, 0, 0, 9999, 20, TRUE, TRUE),

-- ── BOARD (1 new — Ayo, traditional West African mancala) ─────────────

  ('ayo', 'Ayo', 'The classic West African strategy game!',
   'Play Ayo — the traditional Nigerian mancala board game — against the AI.',
   'Ayo (Oware) is one of Africa''s oldest and most beloved board games. Two rows of six pits, 48 seeds. Pick up all the seeds from a pit and sow them counter-clockwise, one per pit. Capture seeds when your last drop lands in an opponent''s pit with exactly 2 or 3 seeds. First to 25 seeds wins!',
   '🏺', 'Board', 'ayo', 3, 70, 60, 1, 0, 0, 48, 60, TRUE, TRUE),

-- ── ARCADE (3 new) ────────────────────────────────────────────────────

  ('platform-jumper', 'Platform Jumper', 'Jump from platform to platform!',
   'Guide your character up an endless series of platforms — how high can you go?',
   'Your bouncy character leaps automatically — tap left or right to steer and land on each platform. Miss a platform and you fall to your doom. The higher you climb, the narrower the platforms get. Can you reach the stars?',
   '🦘', 'Arcade', 'platformJumper', 5, 40, 35, 0, 0, 0, 9999999, 10, TRUE, TRUE),

  ('pixel-runner', 'Pixel Runner', 'Run and jump over everything!',
   'Tap to jump over obstacles in this non-stop side-scrolling runner.',
   'Your pixel hero runs forever — tap to jump over walls, spikes and pits that appear in the path. The longer you survive, the faster the pace. One collision and it is all over. How far can you run?',
   '🏃', 'Arcade', 'pixelRunner', 6, 40, 35, 0, 0, 0, 9999999, 10, TRUE, TRUE),

  ('asteroid-dodge', 'Asteroid Dodge', 'Dodge the space rocks!',
   'Steer your spaceship left and right to dodge incoming asteroids.',
   'Your rocket is hurtling through a dense asteroid field. Tap left or right to dodge the rocks — some small, some massive, some moving at terrifying speed. Every second you survive earns points. One collision and you are space dust.',
   '☄️', 'Arcade', 'asteroidDodge', 7, 40, 35, 0, 0, 0, 9999999, 10, TRUE, TRUE),

-- ── TAP (2 new) ───────────────────────────────────────────────────────

  ('speed-tap', 'Speed Tap', 'Tap targets the instant they appear!',
   'React lightning fast — targets shrink and disappear if you miss them.',
   'Bright targets flash up on screen and start shrinking. Tap them before they vanish completely! Every hit scores points; every miss deducts them. The targets get smaller and faster on harder settings. How sharp is your reflex?',
   '🎯', 'Tap', 'speedTap', 5, 35, 28, 0, 0, 0, 9999, 20, TRUE, TRUE),

  ('color-rain', 'Color Rain', 'Tap the drops that match your colour!',
   'Coloured drops fall — tap only those matching the target colour shown.',
   'Drops of four colours rain down the screen. A target colour glows at the top. Tap every drop that matches — and avoid the wrong colours! The rain gets heavier and faster. Stay sharp and keep your score climbing.',
   '🌈', 'Tap', 'colorRain', 6, 35, 28, 0, 0, 0, 9999, 20, TRUE, TRUE),

-- ── TRIVIA (4 new — new category) ────────────────────────────────────

  ('quick-quiz', 'Quick Quiz', 'How much do you know?',
   '10 general-knowledge questions — score big by answering fast.',
   'Ten questions, ten chances to prove your knowledge. Pick the right answer from four choices as fast as you can — the quicker you answer correctly, the bigger the time bonus. Wrong answers score zero. Think you know everything? Prove it!',
   '🧠', 'Trivia', 'quickQuiz', 1, 60, 50, 0, 0, 0, 1750, 30, TRUE, TRUE),

  ('true-or-false', 'True or False', 'Is it fact or fiction?',
   'Rapid-fire true/false statements — answer as many as you can correctly.',
   'A bold statement appears on screen. True or false — decide fast! The timer ticks down and every correct answer bangs up your score. Wrong answers cost you nothing but time. Simple to play, surprisingly addictive to master.',
   '✅', 'Trivia', 'trueOrFalse', 2, 50, 42, 0, 0, 0, 1125, 20, TRUE, TRUE),

  ('emoji-quiz', 'Emoji Quiz', 'Guess the word from emojis!',
   'Figure out the movie, phrase or word hidden in a sequence of emojis.',
   'A cryptic combination of emojis hides a movie title, phrase or concept. Decode the emoji clue and type your answer. Easy puzzles are obvious, hard ones will have you scratching your head. Think you speak emoji fluently?',
   '😎', 'Trivia', 'emojiQuiz', 3, 60, 50, 0, 0, 0, 1400, 30, TRUE, TRUE),

  ('flag-quiz', 'Flag Quiz', 'Which country is that flag?',
   'Identify countries from their flag — pick from four options.',
   'A country flag flashes up — can you name it from four choices? Starts with well-known flags and gets tricky on harder settings. Great for travel lovers, geography buffs, and anyone who wants to learn the world one flag at a time.',
   '🚩', 'Trivia', 'flagQuiz', 4, 50, 42, 0, 0, 0, 750, 15, TRUE, TRUE),

-- ── WORD (3 new) ──────────────────────────────────────────────────────

  ('word-guess', 'Word Guess', 'Guess the 5-letter word in 6 tries!',
   'Wordle-style word guessing. Green = right place, yellow = wrong place.',
   'One secret 5-letter word. Six attempts to find it. Every guess tells you which letters are correct and in the right spot (green), which are in the word but misplaced (yellow), and which aren''t in the word at all (grey). Pure vocabulary meets deduction.',
   '💬', 'Word', 'wordGuess', 3, 55, 45, 0, 0, 0, 600, 15, TRUE, TRUE),

  ('hangman', 'Hangman', 'Guess the word before the man is hanged!',
   'Pick letters one by one to reveal the hidden word before you run out of chances.',
   'A hidden word waits behind a row of blank spaces. Guess letters — correct ones fill in the blanks; wrong ones bring the stick figure closer to doom. Run out of guesses and it is game over. Can you read the word before you run out of chances?',
   '🎭', 'Word', 'hangman', 4, 45, 38, 0, 0, 0, 9999, 10, TRUE, TRUE),

  ('anagram-rush', 'Anagram Rush', 'Unscramble the letters against the clock!',
   'Scrambled letters — rearrange them to spell the correct word.',
   'A word has been scrambled into a jumble of letters. Your mission: unscramble them to spell the original word before time runs out. Ten words per round, each harder than the last. How many can you solve under pressure?',
   '🔀', 'Word', 'anagramRush', 5, 50, 42, 0, 0, 0, 1000, 20, TRUE, TRUE),

-- ── CASUAL (2 new) ────────────────────────────────────────────────────

  ('tic-tac-toe', 'Tic Tac Toe', 'Get three in a row first!',
   'Play classic Tic Tac Toe against an AI opponent.',
   'The timeless 3×3 grid game. You are X, the AI is O. Get three of your marks in a row — horizontal, vertical or diagonal — before the AI does. On Hard mode the AI is completely unbeatable. On Easy it makes mistakes. Good luck!',
   '⭕', 'Casual', 'ticTacToe', 2, 30, 25, 0, 0, 0, 300, 10, TRUE, TRUE),

  ('connect-four', 'Connect Four', 'Drop four in a row!',
   'Drop discs to connect four of your colour in a row.',
   'Drop red discs into the 7×6 grid. Gravity does the rest. Get four in a row — horizontally, vertically or diagonally — before the yellow AI does. Simple rules but deep strategy. Easy AI makes blunders; Hard AI does not.',
   '🔴', 'Casual', 'connectFour', 3, 40, 35, 0, 0, 0, 200, 15, TRUE, TRUE),

-- ── STRATEGY (2 new — new category) ──────────────────────────────────

  ('gem-swap', 'Gem Swap', 'Swap gems to match three or more!',
   'Swap adjacent gems to make rows or columns of three or more matching gems.',
   'A glittering grid of gems. Swap two adjacent gems to line up three or more of the same colour. They disappear, gems fall, and new ones appear. Chain combos earn massive points. 60 seconds on the clock — how high can your score go?',
   '💎', 'Strategy', 'gemSwap', 1, 55, 45, 0, 0, 0, 99999, 30, TRUE, TRUE),

  ('dots-and-boxes', 'Dots & Boxes', 'Draw lines — claim the most boxes!',
   'Connect dots to complete boxes. The player with the most boxes wins.',
   'A grid of dots. Take turns drawing lines between adjacent dots. Complete a box (four sides) and you claim it and get another turn. The one who claims the most boxes when the grid is full wins. Looks simple — feels like chess!',
   '📦', 'Strategy', 'dotsAndBoxes', 2, 50, 42, 0, 0, 0, 1250, 30, TRUE, TRUE),

-- ── SPORTS (2 new — new category) ────────────────────────────────────

  ('penalty-kick', 'Penalty Kick', 'Aim and shoot — score the penalty!',
   'Time your aim and power to score past the goalkeeper.',
   'Step up to the spot. A cursor sweeps across the goal — tap to lock your aim. Then a power bar charges up — tap again to set your power. The goalkeeper dives. GOAL or SAVE? Five kicks to prove your nerve under pressure.',
   '⚽', 'Sports', 'penaltyKick', 1, 55, 45, 0, 0, 0, 500, 15, TRUE, TRUE),

  ('basketball-shot', 'Basketball Shot', 'Perfect timing is everything!',
   'Tap at exactly the right moment to sink the basketball.',
   'A basketball swings on an arc over the hoop. Tap when the ball aligns with the basket for the perfect shot. The sweet spot shrinks on harder difficulties and the arc speeds up. 10 shots — can you sink them all?',
   '🏀', 'Sports', 'basketballShot', 2, 45, 38, 0, 0, 0, 300, 10, TRUE, TRUE),

-- ── MUSIC (1 new — new category) ─────────────────────────────────────

  ('beat-tap', 'Beat Tap', 'Hit the notes on the beat!',
   'Tap the correct lane when notes reach the hit zone.',
   'Four lanes of falling note blocks drop toward the hit zone at the bottom of each lane. Tap the lane button the instant a note arrives. Perfect timing earns maximum points; late or early taps score less. 30 seconds of rhythm action — how high can you score?',
   '🎵', 'Music', 'beatTap', 1, 55, 45, 0, 0, 0, 1350, 20, TRUE, TRUE)

ON CONFLICT (slug) DO NOTHING;
