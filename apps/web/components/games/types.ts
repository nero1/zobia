/**
 * components/games/types.ts
 *
 * The contract every game engine implements. An engine is a self-contained
 * React component that runs a single play and reports the final integer score
 * via onGameOver. Everything around it (sessions, scoring, rewards, leaderboard,
 * challenges, ads, the Expo WebView host) is generic.
 *
 * To add a new game: create components/games/engines/<engineKey>/index.tsx that
 * default-exports a component of this shape, then register it in engineRegistry.
 */

export interface GameEngineProps {
  /** Fired once the engine has mounted and is interactive. */
  onReady?: () => void;
  /** Fired exactly once when the play ends, with the final score. */
  onGameOver: (score: number) => void;
  /** Optional live score updates during play (for HUD/telemetry). */
  onScore?: (score: number) => void;
}
