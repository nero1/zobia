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
 * BUG-031 FIX: use BigInt arithmetic to avoid IEEE 754 precision loss for pots
 * near Number.MAX_SAFE_INTEGER (2^53 - 1). JS floating-point multiplication
 * `pot * (100 - rake)` loses integer precision above ~9 quadrillion credits.
 * BigInt integer division is exact and floors naturally.
 *
 * @param pot     Total escrowed credits (sum of both stakes).
 * @param rakePct Platform rake percentage (clamped to 0–100).
 */
export function computeWagerPayout(pot: number, rakePct: number): number {
  if (pot <= 0) return 0;
  const rake = Math.min(100, Math.max(0, rakePct));
  // Use BigInt for the multiplication and division to avoid precision loss
  const result = (BigInt(Math.trunc(pot)) * BigInt(100 - Math.trunc(rake))) / 100n;
  return Number(result);
}

/** The required round wins for a best-of-N series (1 → 1, 3 → 2). */
export function requiredWins(rounds: number): number {
  return rounds <= 1 ? 1 : Math.floor(rounds / 2) + 1;
}
