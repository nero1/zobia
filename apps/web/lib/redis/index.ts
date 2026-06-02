/**
 * lib/redis/index.ts
 *
 * Redis client factory.
 *
 * Supports two providers selected via REDIS_PROVIDER:
 *   - "ioredis"  – standard Redis / Valkey via ioredis (self-hosted, Railway, DO)
 *   - "upstash"  – Upstash serverless Redis via their REST-compatible ioredis shim
 *
 * Always import `redis` from this module.  Never instantiate a client directly.
 *
 * @example
 * ```ts
 * import { redis } from '@/lib/redis';
 * await redis.set('key', 'value', 'EX', 60);
 * const val = await redis.get('key');
 * ```
 */

import IORedis from "ioredis";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Shared client interface (subset used by the app)
// ---------------------------------------------------------------------------

/**
 * Minimal Redis command interface the application depends on.
 * Both ioredis and the Upstash ioredis shim satisfy this.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<"OK" | null>;
  set(key: string, value: string, exMode: "EX", seconds: number): Promise<"OK" | null>;
  set(key: string, value: string, pxMode: "PX", milliseconds: number): Promise<"OK" | null>;
  setex(key: string, seconds: number, value: string): Promise<"OK">;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  hgetall(key: string): Promise<Record<string, string> | null>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  sismember(key: string, member: string): Promise<number>;
  incr(key: string): Promise<number>;
  incrby(key: string, increment: number): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<"OK">;
}

// ---------------------------------------------------------------------------
// ioredis factory
// ---------------------------------------------------------------------------

let _ioredisClient: IORedis | null = null;

function createIoRedisClient(): IORedis {
  if (_ioredisClient) return _ioredisClient;

  _ioredisClient = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    connectTimeout: 8_000,
    // Reconnect with exponential back-off capped at 10 s
    retryStrategy: (times) => Math.min(times * 200, 10_000),
  });

  _ioredisClient.on("error", (err) => {
    console.error("[redis:ioredis] error", err);
  });

  _ioredisClient.on("connect", () => {
    if (env.NODE_ENV !== "production") {
      console.log("[redis:ioredis] connected");
    }
  });

  return _ioredisClient;
}

// ---------------------------------------------------------------------------
// Upstash factory
// ---------------------------------------------------------------------------

let _upstashClient: IORedis | null = null;

/**
 * Upstash exposes a Redis-compatible REST endpoint.
 * We use ioredis pointed at the Upstash REST URL with token auth.
 * Upstash also provides an @upstash/redis package, but ioredis keeps the
 * interface uniform across providers.
 */
function createUpstashClient(): IORedis {
  if (_upstashClient) return _upstashClient;

  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error(
      "[redis:upstash] UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN " +
        "must be set when REDIS_PROVIDER=upstash"
    );
  }

  // Upstash REST URL looks like: https://xxx.upstash.io
  // Convert to redis:// for ioredis by using the TLS endpoint on 6380
  const restUrl = new URL(env.UPSTASH_REDIS_REST_URL);
  const redisUrl = `rediss://:${env.UPSTASH_REDIS_REST_TOKEN}@${restUrl.hostname}:6380`;

  _upstashClient = new IORedis(redisUrl, {
    tls: {},
    maxRetriesPerRequest: 3,
    connectTimeout: 10_000,
    retryStrategy: (times) => Math.min(times * 300, 15_000),
  });

  _upstashClient.on("error", (err) => {
    console.error("[redis:upstash] error", err);
  });

  return _upstashClient;
}

// ---------------------------------------------------------------------------
// Exported singleton
// ---------------------------------------------------------------------------

/**
 * The active Redis client.
 * Provider is selected via REDIS_PROVIDER ("ioredis" | "upstash").
 */
export function getRedisClient(): RedisClient {
  switch (env.REDIS_PROVIDER) {
    case "ioredis":
      return createIoRedisClient() as unknown as RedisClient;
    case "upstash":
      return createUpstashClient() as unknown as RedisClient;
    default: {
      const _exhaustive: never = env.REDIS_PROVIDER;
      throw new Error(`[redis] Unknown REDIS_PROVIDER: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Singleton Redis client instance.
 * Lazily initialised on first property access.
 */
export const redis: RedisClient = new Proxy({} as RedisClient, {
  get(_target, prop) {
    const client = getRedisClient();
    const value = (client as Record<string | symbol, unknown>)[prop];
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});

/**
 * Close the Redis connection gracefully.
 * Call this on process exit to avoid connection leaks.
 */
export async function closeRedis(): Promise<void> {
  if (_ioredisClient) {
    await _ioredisClient.quit();
    _ioredisClient = null;
  }
  if (_upstashClient) {
    await _upstashClient.quit();
    _upstashClient = null;
  }
}
