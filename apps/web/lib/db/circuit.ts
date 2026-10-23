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
    const outcome = await dbCircuit.execute(async () => {
      try {
        return { ok: true as const, value: await fn() };
      } catch (error) {
        let cause = error as {
          code?: string;
          message?: string;
          cause?: unknown;
        };
        for (let depth = 0; depth < 3 && cause?.cause; depth++)
          cause = cause.cause as typeof cause;
        const code = cause?.code ?? "",
          message = cause?.message ?? "";
        if (
          /^(08|53|57P|57014)/.test(code) ||
          [
            "ECONNRESET",
            "ECONNREFUSED",
            "ETIMEDOUT",
            "ENOTFOUND",
            "EPIPE",
          ].includes(code) ||
          /connection (?:terminated|timeout|timed out|closed)|timeout exceeded when trying to connect/i.test(
            message,
          )
        )
          throw error;
        // A rejected business operation or SQL constraint says nothing about
        // database availability; it must not open a circuit for every user.
        return { ok: false as const, error };
      }
    });
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  } catch (err) {
    // Only the breaker's own rejections are prefixed with "[database]" (its
    // configured `name`) — real errors from `fn()` never carry this prefix,
    // so this check can't accidentally reclassify a genuine query error.
    if (err instanceof Error && err.message.startsWith("[database]")) {
      const serviceUnavailable = new Error(
        "Database is temporarily unavailable — please try again shortly",
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

/** Transaction-local server context works with direct PG and transaction poolers.
 * No session GUC is assumed to survive between requests or pool checkouts. */
export function wrapPoolWithCircuitBreaker(
  pool: import("pg").Pool & { __circuitWrapped?: boolean },
): void {
  if (pool.__circuitWrapped) return;
  pool.__circuitWrapped = true;
  const connect = pool.connect.bind(pool);
  type ContextClient = import("pg").PoolClient & { __contextWrapped?: boolean };
  function prepare(client: ContextClient): ContextClient {
    if (client.__contextWrapped) return client;
    client.__contextWrapped = true;
    const query = client.query.bind(client);
    client.query = ((...args: unknown[]) => {
      const value = args[0];
      const text =
        typeof value === "string" ? value : (value as { text?: string })?.text;
      const result = (query as (...args: unknown[]) => Promise<unknown>)(
        ...args,
      );
      if (/^\s*begin\b/i.test(text ?? "")) {
        return result.then(async (value) => {
          await query(
            "SELECT set_config('app.is_system','true',true),set_config('statement_timeout','10000',true),set_config('idle_in_transaction_session_timeout','15000',true)",
          );
          return value;
        });
      }
      return result;
    }) as typeof client.query;
    return client;
  }
  pool.connect = ((
    callback?: (
      error: Error | undefined,
      client: import("pg").PoolClient | undefined,
      release: () => void,
    ) => void,
  ) => {
    if (callback)
      return connect((error, client, release) =>
        callback(error, client ? prepare(client) : client, release),
      );
    return connect().then(prepare);
  }) as typeof pool.connect;
  pool.query = ((...args: unknown[]) => {
    const callback =
      typeof args.at(-1) === "function"
        ? (args.pop() as (error: unknown, result?: unknown) => void)
        : undefined;
    const task = withCircuitBreaker(async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await (
          client.query as (...args: unknown[]) => Promise<unknown>
        )(...args);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    });
    if (callback) {
      void task.then(
        (value) => callback(null, value),
        (error) => callback(error),
      );
      return;
    }
    return task;
  }) as typeof pool.query;
}
