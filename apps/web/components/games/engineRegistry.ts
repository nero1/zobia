"use client";

/**
 * components/games/engineRegistry.ts
 *
 * Lazy map of engineKey → game engine component. Code-split so the directory
 * page and cover pages never pull in game code until a play actually starts.
 *
 * To add a new game: add its engine module under engines/<engineKey>/ and a
 * single line here. Keep the key in sync with shared/utils/games GAME_REGISTRY
 * and the engine_key column in the games table.
 */

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { GameEngineProps } from "@/components/games/types";

const loading = () => null;

// next/dynamic's inferred ComponentType can resolve to a different @types/react
// copy in this monorepo, so each entry is cast to our local React ComponentType.
type Engine = ComponentType<GameEngineProps>;
// Use `() => Promise<any>` so the module-namespace return type of bare dynamic
// imports (`typeof import("...")`) doesn't trigger TS2345 in stricter tsc builds.
const d = (path: () => Promise<any>) =>
  dynamic(path as Parameters<typeof dynamic>[0], { ssr: false, loading }) as unknown as Engine;

export const ENGINES: Record<string, Engine> = {
  // Original 6
  tetris:            d(() => import("@/components/games/engines/tetris")),
  g2048:             d(() => import("@/components/games/engines/g2048")),
  carRacing:         d(() => import("@/components/games/engines/carRacing")),
  spaceShooter:      d(() => import("@/components/games/engines/spaceShooter")),
  snake:             d(() => import("@/components/games/engines/snake")),
  breakout:          d(() => import("@/components/games/engines/breakout")),
  // Tap games
  tapFrenzy:         d(() => import("@/components/games/engines/tapFrenzy")),
  bubbleBurst:       d(() => import("@/components/games/engines/bubbleBurst")),
  reactionRush:      d(() => import("@/components/games/engines/reactionRush")),
  colorTap:          d(() => import("@/components/games/engines/colorTap")),
  // Arcade
  flappyDuck:        d(() => import("@/components/games/engines/flappyDuck")),
  stackTower:        d(() => import("@/components/games/engines/stackTower")),
  // Idle
  cookieKingdom:     d(() => import("@/components/games/engines/cookieKingdom")),
  galaxyMiner:       d(() => import("@/components/games/engines/galaxyMiner")),
  // Puzzle
  memoryMatch:       d(() => import("@/components/games/engines/memoryMatch")),
  slidePuzzle:       d(() => import("@/components/games/engines/slidePuzzle")),
  minesweeper:       d(() => import("@/components/games/engines/minesweeper")),
  colorSort:         d(() => import("@/components/games/engines/colorSort")),
  // Card
  blackjack:         d(() => import("@/components/games/engines/blackjack")),
  whot:              d(() => import("@/components/games/engines/whot")),
  higherOrLower:     d(() => import("@/components/games/engines/higherOrLower")),
  // Board
  chess:             d(() => import("@/components/games/engines/chess")),
  ludo:              d(() => import("@/components/games/engines/ludo")),
  // Word / Memory
  wordScramble:      d(() => import("@/components/games/engines/wordScramble")),
  simonSays:         d(() => import("@/components/games/engines/simonSays")),
  // Casual
  rockPaperScissors: d(() => import("@/components/games/engines/rockPaperScissors")),

  // ── Expansion: 30 new games ───────────────────────────────────────────────

  // Puzzle (8 new)
  sudoku:            d(() => import("@/components/games/engines/sudoku")),
  wordSearch:        d(() => import("@/components/games/engines/wordSearch")),
  lightsOut:         d(() => import("@/components/games/engines/lightsOut")),
  numberMatch:       d(() => import("@/components/games/engines/numberMatch")),
  nonogram:          d(() => import("@/components/games/engines/nonogram")),
  pipeConnect:       d(() => import("@/components/games/engines/pipeConnect")),
  slidingBlocks:     d(() => import("@/components/games/engines/slidingBlocks")),
  mahjongSolitaire:  d(() => import("@/components/games/engines/mahjongSolitaire")),

  // Action (2 new)
  whackAMole:        d(() => import("@/components/games/engines/whackAMole")),
  fruitSlicer:       d(() => import("@/components/games/engines/fruitSlicer")),

  // Board (1 new — Ayo/Mancala)
  ayo:               d(() => import("@/components/games/engines/ayo")),

  // Arcade (3 new)
  platformJumper:    d(() => import("@/components/games/engines/platformJumper")),
  pixelRunner:       d(() => import("@/components/games/engines/pixelRunner")),
  asteroidDodge:     d(() => import("@/components/games/engines/asteroidDodge")),

  // Tap (2 new)
  speedTap:          d(() => import("@/components/games/engines/speedTap")),
  colorRain:         d(() => import("@/components/games/engines/colorRain")),

  // Trivia (4 new)
  quickQuiz:         d(() => import("@/components/games/engines/quickQuiz")),
  trueOrFalse:       d(() => import("@/components/games/engines/trueOrFalse")),
  emojiQuiz:         d(() => import("@/components/games/engines/emojiQuiz")),
  flagQuiz:          d(() => import("@/components/games/engines/flagQuiz")),

  // Word (3 new)
  wordGuess:         d(() => import("@/components/games/engines/wordGuess")),
  hangman:           d(() => import("@/components/games/engines/hangman")),
  anagramRush:       d(() => import("@/components/games/engines/anagramRush")),

  // Casual (2 new)
  ticTacToe:         d(() => import("@/components/games/engines/ticTacToe")),
  connectFour:       d(() => import("@/components/games/engines/connectFour")),

  // Strategy (2 new)
  gemSwap:           d(() => import("@/components/games/engines/gemSwap")),
  dotsAndBoxes:      d(() => import("@/components/games/engines/dotsAndBoxes")),

  // Sports (2 new)
  penaltyKick:       d(() => import("@/components/games/engines/penaltyKick")),
  basketballShot:    d(() => import("@/components/games/engines/basketballShot")),

  // Music (1 new)
  beatTap:           d(() => import("@/components/games/engines/beatTap")),
};

export function getEngine(engineKey: string | null | undefined): Engine | null {
  if (!engineKey) return null;
  return ENGINES[engineKey] ?? null;
}
