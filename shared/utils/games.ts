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
 * Built-in launch games: 3 categories × 2. These mirror the seed rows in
 * 0013_games_feature.sql. The DB is the runtime source of truth for display +
 * reward config; this registry is the source of truth for which engine renders.
 */
export const GAME_REGISTRY: GameDefinition[] = [
  { slug: "tetris",        engineKey: "tetris",       category: "Puzzle", defaultName: "Zobia Tetris", defaultEmoji: "🧩" },
  { slug: "2048",          engineKey: "g2048",        category: "Puzzle", defaultName: "2048",         defaultEmoji: "🔢" },
  { slug: "car-racing",    engineKey: "carRacing",    category: "Action", defaultName: "Speed Dodge",  defaultEmoji: "🏎️" },
  { slug: "space-shooter", engineKey: "spaceShooter", category: "Action", defaultName: "Star Blaster", defaultEmoji: "🚀" },
  { slug: "snake",         engineKey: "snake",        category: "Arcade", defaultName: "Zobia Snake",  defaultEmoji: "🐍" },
  { slug: "breakout",      engineKey: "breakout",     category: "Arcade", defaultName: "Brick Buster", defaultEmoji: "🧱" },
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
