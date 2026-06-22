/**
 * lib/redis/index.ts
 *
 * Redis client factory.
 *
 * Supports two providers selected via REDIS_PROVIDER:
 *   - "ioredis"  – standard Redis / Valkey via ioredis (self-hosted, Railway, DO)
 *   - "upstash"  – Upstash serverless Redis via @upstash/redis (HTTP-based, Vercel)
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
import { Redis as UpstashRedis, type SetCommandOptions } from "@upstash/redis";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Shared client interface (subset used by the app)
// ---------------------------------------------------------------------------

/**
 * Chainable batch of commands queued for a single round-trip via `RedisClient.pipeline()`.
 * Both providers implement this interface (ioredis natively, Upstash via adapter).
 *
 * @pipeline-commands: del, exists, zremrangebyrank, setex, expire, hset, zadd
 */
export interface RedisPipeline {
  del(key: string): RedisPipeline;
  exists(key: string): RedisPipeline;
  zremrangebyrank(key: string, start: number, stop: number): RedisPipeline;
  setex(key: string, seconds: number, value: string): RedisPipeline;
  expire(key: string, seconds: number): RedisPipeline;
  hset(key: string, field: string, value: string): RedisPipeline;
  zadd(key: string, score: number, member: string): RedisPipeline;
  exec(): Promise<unknown[]>;
}

/**
 * Minimal Redis command interface the application depends on.
 * Both providers implement this interface (ioredis natively, Upstash via adapter).
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  getdel(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<"OK" | null>;
  set(key: string, value: string, exMode: "EX", seconds: number): Promise<"OK" | null>;
  set(key: string, value: string, pxMode: "PX", milliseconds: number): Promise<"OK" | null>;
  set(key: string, value: string, exMode: "EX", seconds: number, nx: "NX"): Promise<"OK" | null>;
  set(key: string, value: string, pxMode: "PX", milliseconds: number, nx: "NX"): Promise<"OK" | null>;
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
  decr(key: string): Promise<number>;
  incrby(key: string, increment: number): Promise<number>;
  decrby(key: string, decrement: number): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrem(key: string, ...members: string[]): Promise<number>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zremrangebyrank(key: string, start: number, stop: number): Promise<number>;
  /** Execute a Lua script atomically. Compatible with ioredis eval(script, numkeys, ...args). */
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
  /** Queue commands for a single round-trip. Not atomic — see provider docs. */
  pipeline(): RedisPipeline;
  ping(): Promise<string>;
  quit(): Promise<"OK">;
}

// ---------------------------------------------------------------------------
// Build-time stub
// ---------------------------------------------------------------------------

// During Next.js static build Redis is unavailable — return a no-op stub so
// pages can be generated without hanging on connection timeouts.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

function createStubPipeline(): RedisPipeline {
  const stub: RedisPipeline = {
    del: () => stub,
    exists: () => stub,
    zremrangebyrank: () => stub,
    setex: () => stub,
    expire: () => stub,
    hset: () => stub,
    zadd: () => stub,
    exec: async () => [],
  };
  return stub;
}

const buildStub: RedisClient = new Proxy({} as RedisClient, {
  get(_t, prop) {
    if (prop === "ping") return async () => "PONG";
    if (prop === "quit") return async () => "OK";
    if (prop === "pipeline") return () => createStubPipeline();
    return async () => null;
  },
});

// ---------------------------------------------------------------------------
// ioredis provider (self-hosted Redis, Railway, DigitalOcean, etc.)
// ---------------------------------------------------------------------------

let _ioredisClient: IORedis | null = null;

function createIoRedisClient(): IORedis {
  if (_ioredisClient) return _ioredisClient;

  if (!env.REDIS_URL) {
    throw new Error("[redis:ioredis] REDIS_URL is not set");
  }

  _ioredisClient = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 8_000,
    retryStrategy: (times) => Math.min(times * 200, 10_000) + Math.floor(Math.random() * 200),
  });

  _ioredisClient.on("error", (err) => {
    logger.error({ err }, "[redis:ioredis] error");
  });

  _ioredisClient.on("connect", () => {
    if (env.NODE_ENV !== "production") {
      logger.debug("[redis:ioredis] connected");
    }
  });

  return _ioredisClient;
}

// ---------------------------------------------------------------------------
// Upstash adapter
//
// @upstash/redis uses a different calling convention than ioredis:
//   - set(key, value, { ex: n })  instead of  set(key, value, 'EX', n)
//   - hset(key, { field: value }) instead of  hset(key, field, value)
//   - sismember returns boolean   instead of  0 | 1
//
// UpstashAdapter wraps the @upstash/redis client and translates each call
// to match the RedisClient interface so the rest of the app is unaware.
// ---------------------------------------------------------------------------

class UpstashAdapter implements RedisClient {
  constructor(private readonly client: UpstashRedis) {}

  async get(key: string): Promise<string | null> {
    // Use get<unknown> because Upstash auto-deserializes JSON-serialized values.
    // When the stored value is a JSON object (e.g. session records), Upstash
    // returns the parsed object instead of the raw string, breaking callers that
    // expect a string and call JSON.parse on the result.  Re-serialize here so
    // the RedisClient contract (Promise<string | null>) is always honoured.
    const value = await this.client.get<unknown>(key);
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  }

  async getdel(key: string): Promise<string | null> {
    const value = await this.client.getdel<unknown>(key);
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  }

  set(key: string, value: string, exMode?: "EX" | "PX", ttl?: number, nx?: "NX"): Promise<"OK" | null> {
    const opts: { ex?: number; px?: number; nx?: true } = {};
    if (exMode === "EX" && ttl !== undefined) opts.ex = ttl;
    if (exMode === "PX" && ttl !== undefined) opts.px = ttl;
    if (nx === "NX") opts.nx = true;
    if (Object.keys(opts).length > 0) {
      return this.client.set(key, value, opts as SetCommandOptions) as Promise<"OK" | null>;
    }
    return this.client.set(key, value) as Promise<"OK" | null>;
  }

  async setex(key: string, seconds: number, value: string): Promise<"OK"> {
    await this.client.set(key, value, { ex: seconds });
    return "OK";
  }

  del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return Promise.resolve(0);
    return this.client.del(...(keys as [string, ...string[]]));
  }

  exists(...keys: string[]): Promise<number> {
    if (keys.length === 0) return Promise.resolve(0);
    return this.client.exists(...(keys as [string, ...string[]]));
  }

  expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds) as Promise<number>;
  }

  ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  hset(key: string, field: string, value: string): Promise<number> {
    return this.client.hset(key, { [field]: value });
  }

  hget(key: string, field: string): Promise<string | null> {
    return this.client.hget<string>(key, field);
  }

  hdel(key: string, ...fields: string[]): Promise<number> {
    return this.client.hdel(key, ...fields);
  }

  hgetall(key: string): Promise<Record<string, string> | null> {
    return this.client.hgetall(key) as Promise<Record<string, string> | null>;
  }

  sadd(key: string, ...members: string[]): Promise<number> {
    const [first, ...rest] = members;
    if (first === undefined) return Promise.resolve(0);
    return this.client.sadd(key, first, ...rest);
  }

  srem(key: string, ...members: string[]): Promise<number> {
    const [first, ...rest] = members;
    if (first === undefined) return Promise.resolve(0);
    return this.client.srem(key, first, ...rest);
  }

  smembers(key: string): Promise<string[]> {
    return this.client.smembers(key) as Promise<string[]>;
  }

  async sismember(key: string, member: string): Promise<number> {
    const result = await this.client.sismember(key, member);
    return result ? 1 : 0;
  }

  incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  decr(key: string): Promise<number> {
    return this.client.decr(key);
  }

  incrby(key: string, increment: number): Promise<number> {
    return this.client.incrby(key, increment);
  }

  decrby(key: string, decrement: number): Promise<number> {
    return this.client.decrby(key, decrement);
  }

  zadd(key: string, score: number, member: string): Promise<number> {
    return this.client.zadd(key, { score, member }) as Promise<number>;
  }

  zrem(key: string, ...members: string[]): Promise<number> {
    const [first, ...rest] = members;
    if (first === undefined) return Promise.resolve(0);
    return this.client.zrem(key, first, ...rest) as Promise<number>;
  }

  zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrange(key, start, stop) as Promise<string[]>;
  }

  zremrangebyrank(key: string, start: number, stop: number): Promise<number> {
    return this.client.zremrangebyrank(key, start, stop) as Promise<number>;
  }

  async eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown> {
    const keys = args.slice(0, numkeys).map(String);
    const argv = args.slice(numkeys).map(String);
    return this.client.eval(script, keys, argv);
  }

  pipeline(): RedisPipeline {
    const batch = this.client.pipeline();
    const wrapper: RedisPipeline = {
      del(key: string) {
        batch.del(key);
        return wrapper;
      },
      exists(key: string) {
        batch.exists(key);
        return wrapper;
      },
      zremrangebyrank(key: string, start: number, stop: number) {
        batch.zremrangebyrank(key, start, stop);
        return wrapper;
      },
      setex(key: string, seconds: number, value: string) {
        batch.set(key, value, { ex: seconds });
        return wrapper;
      },
      expire(key: string, seconds: number) {
        batch.expire(key, seconds);
        return wrapper;
      },
      hset(key: string, field: string, value: string) {
        batch.hset(key, { [field]: value });
        return wrapper;
      },
      zadd(key: string, score: number, member: string) {
        batch.zadd(key, { score, member });
        return wrapper;
      },
      exec(): Promise<unknown[]> {
        return batch.exec();
      },
    };
    return wrapper;
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async quit(): Promise<"OK"> {
    // @upstash/redis is stateless HTTP — no persistent connection to close
    return "OK";
  }
}

// ---------------------------------------------------------------------------
// Upstash provider factory
// ---------------------------------------------------------------------------

let _upstashAdapter: UpstashAdapter | null = null;

function createUpstashClient(): UpstashAdapter {
  if (_upstashAdapter) return _upstashAdapter;

  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error(
      "[redis:upstash] UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN " +
        "must be set when REDIS_PROVIDER=upstash"
    );
  }

  const client = new UpstashRedis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  _upstashAdapter = new UpstashAdapter(client);
  return _upstashAdapter;
}

// ---------------------------------------------------------------------------
// Exported singleton
// ---------------------------------------------------------------------------

/**
 * The active Redis client.
 * Provider is selected via REDIS_PROVIDER ("ioredis" | "upstash").
 */
export function getRedisClient(): RedisClient {
  if (isBuildPhase) return buildStub;

  if (!env.REDIS_PROVIDER) {
    throw new Error("[redis] REDIS_PROVIDER is not set");
  }
  switch (env.REDIS_PROVIDER) {
    case "ioredis":
      return createIoRedisClient() as unknown as RedisClient;
    case "upstash":
      return createUpstashClient();
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
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});

/**
 * Close the Redis connection gracefully.
 * Only meaningful for ioredis — Upstash is stateless HTTP.
 */
export async function closeRedis(): Promise<void> {
  if (_ioredisClient) {
    await _ioredisClient.quit();
    _ioredisClient = null;
  }
  _upstashAdapter = null;
}
