/**
 * lib/games/wager.ts
 *
 * Pure helpers for challenge wager economics. Kept side-effect-free so the
 * money math is unit-testable in isolation.
 */

/**
 * Compute the winner's payout from an escrowed pot after the platform rake.
 * Floors to whole credits (the platform keeps the rounding remainder).
 *
 * @param pot     Total escrowed credits (sum of both stakes).
 * @param rakePct Platform rake percentage (clamped to 0–100).
 */
export function computeWagerPayout(pot: number, rakePct: number): number {
  if (pot <= 0) return 0;
  const rake = Math.min(100, Math.max(0, rakePct));
  return Math.floor((pot * (100 - rake)) / 100);
}

/** The required round wins for a best-of-N series (1 → 1, 3 → 2). */
export function requiredWins(rounds: number): number {
  return rounds <= 1 ? 1 : Math.floor(rounds / 2) + 1;
}
