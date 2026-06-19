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
};

export function getEngine(engineKey: string | null | undefined): Engine | null {
  if (!engineKey) return null;
  return ENGINES[engineKey] ?? null;
}
