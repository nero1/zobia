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

export const ENGINES: Record<string, Engine> = {
  tetris: dynamic(() => import("@/components/games/engines/tetris"), { ssr: false, loading }) as unknown as Engine,
  g2048: dynamic(() => import("@/components/games/engines/g2048"), { ssr: false, loading }) as unknown as Engine,
  carRacing: dynamic(() => import("@/components/games/engines/carRacing"), { ssr: false, loading }) as unknown as Engine,
  spaceShooter: dynamic(() => import("@/components/games/engines/spaceShooter"), { ssr: false, loading }) as unknown as Engine,
  snake: dynamic(() => import("@/components/games/engines/snake"), { ssr: false, loading }) as unknown as Engine,
  breakout: dynamic(() => import("@/components/games/engines/breakout"), { ssr: false, loading }) as unknown as Engine,
};

export function getEngine(engineKey: string | null | undefined): ComponentType<GameEngineProps> | null {
  if (!engineKey) return null;
  return ENGINES[engineKey] ?? null;
}
