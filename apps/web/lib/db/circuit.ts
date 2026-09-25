/**
 * lib/db/circuit.ts
 *
 * Circuit breaker for database connections.
 *
 * ---------------------------------------------------------------------------
 * REDIS-COST-01 — why this breaker is IN-PROCESS, not Redis-backed
 * ---------------------------------------------------------------------------
 * This module previously used the Redis-backed `RedisCircuitBreaker` so that
 * breaker state was shared across serverless instances. That turned out to be
 * the single largest consumer of our Redis quota:
 *
 *   - `withCircuitBreaker` wraps EVERY `db.query()` and EVERY `db.transaction()`
 *     (see lib/db/providers/{supabase,railway,digitalocean}.ts).
 *   - Each wrapped call cost a `GET circuit:database` (fronted by a 2 s
 *     in-process cache that is close to useless on serverless, where instances
 *     are cold and short-lived) plus an `EVAL` that itself does a `GET` and a
 *     `SET` on the same key.
 *   - A route issuing three queries therefore spent ~12 Redis commands purely
 *     to ask "is Postgres healthy?", and every instance in the fleet was
 *     read-modify-writing one hot key.
 *
 * The distributed state bought us very little in return. On Vercel each
 * instance serves a handful of requests before being recycled, so a shared
 * breaker rarely gets to "warn" an instance that would not have discovered the
 * outage itself within a request or two. The trade we make by going
 * in-process is bounded and cheap: a freshly cold instance tolerates up to
 * `windowSize` failures before it opens its own breaker, instead of inheriting
 * an already-open state from its peers. Postgres connection failures are fast
 * (they do not hang for the full `callTimeoutMs`), so those few extra attempts
 * cost milliseconds, not seconds.
 *
 * If you later move to a long-lived runtime (a container, a VM, a Node server
 * behind a load balancer) where instances are few and long-running, shared
 * breaker state becomes worth paying for again. Set
 * `DB_CIRCUIT_DISTRIBUTED=1` to opt back into the Redis-backed breaker without
 * a code change — everything below is written against the shared
 * `CircuitBreakerLike` shape so the two are drop-in interchangeable.
 *
 * BUG-CAP-02 fix (retained): this module previously defined
 * `dbCircuit`/`withCircuitBreaker` but nothing ever imported them, so a degraded
 * database had no fail-fast path. `withCircuitBreaker` is now called from every
 * DB provider adapter's `query()`/`transaction()`.
 */

import {
  CircuitBreaker,
  RedisCircuitBreaker,
  type CircuitMetrics,
} from "@/lib/payments/circuit";

/**
 * The subset of the breaker API this module depends on. Both the in-process
 * `CircuitBreaker` (synchronous `getMetrics`) and the Redis-backed
 * `RedisCircuitBreaker` (async `getMetrics`) satisfy it, so the implementation
 * can be swapped by env var alone. Callers should `await` `getMetrics()` —
 * awaiting a plain value is a no-op, so the same call site works for both.
 */
interface CircuitBreakerLike {
  execute<T>(fn: () => Promise<T>): Promise<T>;
  getMetrics(): CircuitMetrics | Promise<CircuitMetrics>;
}

/**
 * Opt back into Redis-backed (cross-instance) breaker state.
 *
 * Read from `process.env` directly rather than `lib/env` because this module is
 * imported by the DB providers, which `lib/env` itself may transitively depend
 * on during validation — going through `env` here risks a circular import at
 * module-load time.
 */
const USE_DISTRIBUTED_DB_CIRCUIT = process.env.DB_CIRCUIT_DISTRIBUTED === "1";

const CIRCUIT_OPTIONS = {
  name: "database",
  errorThresholdPercentage: 50,
  successThreshold: 2,
  windowSize: 10,
  resetTimeoutMs: 15_000,
  callTimeoutMs: 10_000,
} as const;

export const dbCircuit: CircuitBreakerLike = USE_DISTRIBUTED_DB_CIRCUIT
  ? new RedisCircuitBreaker({ ...CIRCUIT_OPTIONS })
  : new CircuitBreaker({ ...CIRCUIT_OPTIONS });

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

// ---------------------------------------------------------------------------
// Pool-level wrapping — covers Drizzle's direct pg.Pool usage
// ---------------------------------------------------------------------------

/**
 * BUG (discovered while investigating a raw, unhandled-looking 500 on
 * GET /api/creator/dashboard that happened to log a breaker state change
 * nearby): every provider adapter's own `query()`/`transaction()` methods
 * are wrapped in `withCircuitBreaker` above, but `lib/db/drizzle.ts`'s
 * `getDb()` hands the *same* underlying `pg.Pool` straight to Drizzle
 * (`drizzle(pool, { schema })`) and Drizzle calls `pool.query(...)` on it
 * directly — completely bypassing the adapter wrapper, and therefore the
 * breaker. Since "full Drizzle ORM coverage" (see PR #532) moved nearly all
 * application code from `db.query()` (protected) onto `getDb()`/Drizzle
 * (unprotected), the breaker had stopped protecting the vast majority of
 * real traffic: during a DB outage, Drizzle-issued queries would each hang
 * for the full `statement_timeout`/`connectionTimeoutMillis` instead of
 * failing fast with a clean 503, and never contributed to (or benefited
 * from) the breaker's OPEN/CLOSED state at all.
 *
 * Fix: wrap the Pool's own `query` method once, at the lowest shared layer
 * (the Pool itself, not each caller), so both the legacy adapter and every
 * Drizzle call issued against the same pool go through the same breaker.
 * Only the non-transactional `pool.query(...)` path is wrapped — the
 * per-adapter `transaction()` methods above already wrap their own
 * `pool.connect()` + multi-statement unit of work, and Drizzle's own
 * `.transaction()` similarly checks out a dedicated client via
 * `pool.connect()`; wrapping `connect()` too would double-count a single
 * transaction's queries against the breaker's window and is left alone.
 * Callback-style `pool.query(text, cb)` calls (unused anywhere in this
 * codebase — everything here is promise-based) fall through to the
 * original method untouched rather than risk breaking that signature.
 *
 * Idempotent — safe to call on the same pool more than once (double-wrapping
 * is a harmless no-op check via `__circuitWrapped`).
 */
export function wrapPoolWithCircuitBreaker(pool: {
  query: (...args: unknown[]) => unknown;
  __circuitWrapped?: boolean;
}): void {
  if (pool.__circuitWrapped) return;
  pool.__circuitWrapped = true;

  const originalQuery = pool.query.bind(pool);
  pool.query = (...args: unknown[]) => {
    const lastArg = args[args.length - 1];
    if (typeof lastArg === "function") {
      // Callback style — bypass the breaker rather than risk mismatching pg's
      // callback-based overload signature. Not used anywhere in this codebase.
      return originalQuery(...args);
    }
    return withCircuitBreaker(() => Promise.resolve(originalQuery(...args)) as Promise<unknown>);
  };
}
