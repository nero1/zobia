/**
 * shared/utils/games.ts
 *
 * Single source of truth for the built-in game catalogue, shared by the web
 * app, the PWA and the Expo app (via `@zobia/shared/utils`).
 *
 * THE "PLUG IN A NEW GAME" CONTRACT
 * ---------------------------------
 * A game is identified by a stable `engineKey`. To add a new game a developer:
 *   1. Adds an entry to GAME_REGISTRY below (slug + engineKey + category +
 *      display defaults).
 *   2. Adds a client engine module at
 *      apps/web/components/games/engines/<engineKey>/index.tsx implementing the
 *      shared GameEngineProps contract (onReady / onGameOver(score)).
 *   3. Registers the lazy import in apps/web/components/games/engineRegistry.ts.
 *   4. Adds a seed row in a migration (admin can then edit the cover page,
 *      rewards and play cost at runtime).
 *
 * Everything else — directory listing, /g/<slug> cover, play sessions, scoring,
 * rewards, leaderboards, challenges, ads, the WebView host on Expo — is generic
 * and needs no per-game code.
 */

import type { GameCategory } from "../types";

export interface GameDefinition {
  /** URL slug under /g/<slug>. Stable; slug changes are handled by redirects. */
  slug: string;
  /** Stable engine identifier mapping to the client engine module. */
  engineKey: string;
  category: GameCategory;
  /** Default display name (DB row overrides this at runtime). */
  defaultName: string;
  /** Default cover emoji (DB row overrides this at runtime). */
  defaultEmoji: string;
}

/**
 * Built-in game catalogue. Mirrors DB seed rows. The DB is the runtime source
 * of truth for display + reward config; this registry is the source of truth
 * for which engine renders.
 */
export const GAME_REGISTRY: GameDefinition[] = [
  // Original 6
  { slug: "tetris",               engineKey: "tetris",             category: "Puzzle",  defaultName: "Zobia Tetris",        defaultEmoji: "🧩" },
  { slug: "2048",                 engineKey: "g2048",              category: "Puzzle",  defaultName: "2048",                defaultEmoji: "🔢" },
  { slug: "car-racing",           engineKey: "carRacing",          category: "Action",  defaultName: "Speed Dodge",         defaultEmoji: "🏎️" },
  { slug: "space-shooter",        engineKey: "spaceShooter",       category: "Action",  defaultName: "Star Blaster",        defaultEmoji: "🚀" },
  { slug: "snake",                engineKey: "snake",              category: "Arcade",  defaultName: "Zobia Snake",         defaultEmoji: "🐍" },
  { slug: "breakout",             engineKey: "breakout",           category: "Arcade",  defaultName: "Brick Buster",        defaultEmoji: "🧱" },
  // Tap Games
  { slug: "tap-frenzy",           engineKey: "tapFrenzy",          category: "Tap",     defaultName: "Tap Frenzy",          defaultEmoji: "👆" },
  { slug: "bubble-burst",         engineKey: "bubbleBurst",        category: "Tap",     defaultName: "Bubble Burst",        defaultEmoji: "🫧" },
  { slug: "reaction-rush",        engineKey: "reactionRush",       category: "Tap",     defaultName: "Reaction Rush",       defaultEmoji: "⚡" },
  { slug: "color-tap",            engineKey: "colorTap",           category: "Tap",     defaultName: "Color Tap",           defaultEmoji: "🎨" },
  // Arcade
  { slug: "flappy-duck",          engineKey: "flappyDuck",         category: "Arcade",  defaultName: "Flappy Duck",         defaultEmoji: "🦆" },
  { slug: "stack-tower",          engineKey: "stackTower",         category: "Arcade",  defaultName: "Stack Tower",         defaultEmoji: "🏗️" },
  // Idle
  { slug: "cookie-kingdom",       engineKey: "cookieKingdom",      category: "Idle",    defaultName: "Cookie Kingdom",      defaultEmoji: "🍪" },
  { slug: "galaxy-miner",         engineKey: "galaxyMiner",        category: "Idle",    defaultName: "Galaxy Miner",        defaultEmoji: "⛏️" },
  // Puzzle
  { slug: "memory-match",         engineKey: "memoryMatch",        category: "Puzzle",  defaultName: "Memory Match",        defaultEmoji: "🃏" },
  { slug: "slide-puzzle",         engineKey: "slidePuzzle",        category: "Puzzle",  defaultName: "Slide Puzzle",        defaultEmoji: "🔢" },
  { slug: "minesweeper",          engineKey: "minesweeper",        category: "Puzzle",  defaultName: "Minesweeper",         defaultEmoji: "💣" },
  { slug: "color-sort",           engineKey: "colorSort",          category: "Puzzle",  defaultName: "Color Sort",          defaultEmoji: "🎨" },
  // Card
  { slug: "blackjack",            engineKey: "blackjack",          category: "Card",    defaultName: "Blackjack",           defaultEmoji: "🃏" },
  { slug: "whot",                 engineKey: "whot",               category: "Card",    defaultName: "Whot!",               defaultEmoji: "🎴" },
  { slug: "higher-or-lower",      engineKey: "higherOrLower",      category: "Card",    defaultName: "Higher or Lower",     defaultEmoji: "🎴" },
  // Board
  { slug: "chess",                engineKey: "chess",              category: "Board",   defaultName: "Chess",               defaultEmoji: "♟️" },
  { slug: "ludo",                 engineKey: "ludo",               category: "Board",   defaultName: "Ludo",                defaultEmoji: "🎲" },
  // Word
  { slug: "word-scramble",        engineKey: "wordScramble",       category: "Word",    defaultName: "Word Scramble",       defaultEmoji: "🔤" },
  { slug: "simon-says",           engineKey: "simonSays",          category: "Word",    defaultName: "Simon Says",          defaultEmoji: "🌈" },
  // Casual
  { slug: "rock-paper-scissors",  engineKey: "rockPaperScissors",  category: "Casual",  defaultName: "Rock Paper Scissors", defaultEmoji: "✊" },

  // ── Expansion: 30 new games ───────────────────────────────────────────────

  // Puzzle (8 new)
  { slug: "sudoku",          engineKey: "sudoku",            category: "Puzzle",   defaultName: "Sudoku",           defaultEmoji: "🔢" },
  { slug: "word-search",     engineKey: "wordSearch",        category: "Puzzle",   defaultName: "Word Search",      defaultEmoji: "🔍" },
  { slug: "lights-out",      engineKey: "lightsOut",         category: "Puzzle",   defaultName: "Lights Out",       defaultEmoji: "💡" },
  { slug: "number-match",    engineKey: "numberMatch",       category: "Puzzle",   defaultName: "Number Match",     defaultEmoji: "🔟" },
  { slug: "nonogram",        engineKey: "nonogram",          category: "Puzzle",   defaultName: "Nonogram",         defaultEmoji: "🖼️" },
  { slug: "pipe-connect",    engineKey: "pipeConnect",       category: "Puzzle",   defaultName: "Pipe Connect",     defaultEmoji: "🔧" },
  { slug: "sliding-blocks",  engineKey: "slidingBlocks",     category: "Puzzle",   defaultName: "Sliding Blocks",   defaultEmoji: "🧩" },
  { slug: "mahjong",         engineKey: "mahjongSolitaire",  category: "Puzzle",   defaultName: "Mahjong Solitaire",defaultEmoji: "🀄" },

  // Action (2 new)
  { slug: "whack-a-mole",   engineKey: "whackAMole",        category: "Action",   defaultName: "Whack-a-Mole",     defaultEmoji: "🔨" },
  { slug: "fruit-slicer",   engineKey: "fruitSlicer",       category: "Action",   defaultName: "Fruit Slicer",     defaultEmoji: "🍎" },

  // Board (1 new — Ayo, traditional Nigerian mancala)
  { slug: "ayo",            engineKey: "ayo",               category: "Board",    defaultName: "Ayo",              defaultEmoji: "🏺" },

  // Arcade (3 new)
  { slug: "platform-jumper", engineKey: "platformJumper",   category: "Arcade",   defaultName: "Platform Jumper",  defaultEmoji: "🦘" },
  { slug: "pixel-runner",    engineKey: "pixelRunner",      category: "Arcade",   defaultName: "Pixel Runner",     defaultEmoji: "🏃" },
  { slug: "asteroid-dodge",  engineKey: "asteroidDodge",    category: "Arcade",   defaultName: "Asteroid Dodge",   defaultEmoji: "☄️" },

  // Tap (2 new)
  { slug: "speed-tap",      engineKey: "speedTap",          category: "Tap",      defaultName: "Speed Tap",        defaultEmoji: "🎯" },
  { slug: "color-rain",     engineKey: "colorRain",         category: "Tap",      defaultName: "Color Rain",       defaultEmoji: "🌈" },

  // Trivia (4 new — new category)
  { slug: "quick-quiz",     engineKey: "quickQuiz",         category: "Trivia",   defaultName: "Quick Quiz",       defaultEmoji: "🧠" },
  { slug: "true-or-false",  engineKey: "trueOrFalse",       category: "Trivia",   defaultName: "True or False",    defaultEmoji: "✅" },
  { slug: "emoji-quiz",     engineKey: "emojiQuiz",         category: "Trivia",   defaultName: "Emoji Quiz",       defaultEmoji: "😎" },
  { slug: "flag-quiz",      engineKey: "flagQuiz",          category: "Trivia",   defaultName: "Flag Quiz",        defaultEmoji: "🚩" },

  // Word (3 new)
  { slug: "word-guess",     engineKey: "wordGuess",         category: "Word",     defaultName: "Word Guess",       defaultEmoji: "💬" },
  { slug: "hangman",        engineKey: "hangman",           category: "Word",     defaultName: "Hangman",          defaultEmoji: "🎭" },
  { slug: "anagram-rush",   engineKey: "anagramRush",       category: "Word",     defaultName: "Anagram Rush",     defaultEmoji: "🔀" },

  // Casual (2 new)
  { slug: "tic-tac-toe",   engineKey: "ticTacToe",          category: "Casual",   defaultName: "Tic Tac Toe",      defaultEmoji: "⭕" },
  { slug: "connect-four",  engineKey: "connectFour",        category: "Casual",   defaultName: "Connect Four",     defaultEmoji: "🔴" },

  // Strategy (2 new — new category)
  { slug: "gem-swap",       engineKey: "gemSwap",           category: "Strategy", defaultName: "Gem Swap",         defaultEmoji: "💎" },
  { slug: "dots-and-boxes", engineKey: "dotsAndBoxes",      category: "Strategy", defaultName: "Dots & Boxes",     defaultEmoji: "📦" },

  // Sports (2 new — new category)
  { slug: "penalty-kick",   engineKey: "penaltyKick",       category: "Sports",   defaultName: "Penalty Kick",     defaultEmoji: "⚽" },
  { slug: "basketball-shot",engineKey: "basketballShot",    category: "Sports",   defaultName: "Basketball Shot",  defaultEmoji: "🏀" },

  // Music (1 new — new category)
  { slug: "beat-tap",       engineKey: "beatTap",           category: "Music",    defaultName: "Beat Tap",         defaultEmoji: "🎵" },
];

/** Look up a game definition by its engine key. */
export function getGameByEngineKey(engineKey: string): GameDefinition | undefined {
  return GAME_REGISTRY.find((g) => g.engineKey === engineKey);
}

/** Look up a game definition by its slug. */
export function getGameBySlug(slug: string): GameDefinition | undefined {
  return GAME_REGISTRY.find((g) => g.slug === slug);
}

/** All engine keys known to the client (allowlist for rendering). */
export const KNOWN_ENGINE_KEYS: string[] = GAME_REGISTRY.map((g) => g.engineKey);
