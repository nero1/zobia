/**
 * Circuit breaker for database connections.
 *
 * Uses the same Redis-backed RedisCircuitBreaker from lib/payments/circuit.ts
 * so the circuit state is shared across all serverless instances (rather than
 * being in-process only, which meant each cold-start instance was always CLOSED
 * even when the DB was degraded).
 *
 * BUG-CAP-02 fix: this module previously defined `dbCircuit`/`withCircuitBreaker`
 * but nothing ever imported them, so a degraded database had no fail-fast path —
 * every request still waited out the full pool/statement timeout instead of
 * failing quickly once the error rate tripped. `withCircuitBreaker` is now
 * called from every DB provider adapter's `query()`/`transaction()` (see
 * lib/db/providers/{supabase,railway,digitalocean}.ts).
 */

import { RedisCircuitBreaker } from "@/lib/payments/circuit";

export const dbCircuit = new RedisCircuitBreaker({
  name: "database",
  errorThresholdPercentage: 50,
  successThreshold: 2,
  windowSize: 10,
  resetTimeoutMs: 15_000,
  callTimeoutMs: 10_000,
});

/**
 * Run `fn` through the shared database circuit breaker.
 *
 * When the circuit is OPEN (or the call itself hits the breaker's own
 * `callTimeoutMs`), this throws a plain `Error` carrying `.statusCode = 503`
 * and `.code = "DB_UNAVAILABLE"` — the same "plain error with an explicit
 * statusCode" shape `lib/api/errors.ts`'s `handleApiError()` already knows how
 * to serialize, so no route handler needs to change to get a clean 503
 * response instead of a hung request. Errors thrown by `fn()` itself (real
 * Postgres errors — e.g. unique-violation `.code === "23505"` checks used
 * throughout the economy/payments code) are re-thrown completely unchanged.
 *
 * @param fn - The database operation to protect (a single query or transaction)
 */
export async function withCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await dbCircuit.execute(fn);
  } catch (err) {
    // Only the breaker's own rejections are prefixed with "[database]" (its
    // configured `name`) — real errors from `fn()` never carry this prefix,
    // so this check can't accidentally reclassify a genuine query error.
    if (err instanceof Error && err.message.startsWith("[database]")) {
      const serviceUnavailable = new Error(
        "Database is temporarily unavailable — please try again shortly"
      ) as Error & { statusCode: number; code: string };
      serviceUnavailable.statusCode = 503;
      serviceUnavailable.code = "DB_UNAVAILABLE";
      throw serviceUnavailable;
    }
    throw err;
  }
}
