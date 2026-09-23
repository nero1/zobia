/**
 * lib/security/rateLimit.ts
 *
 * Redis-backed rate limiter with a two-tier cost model.
 *
 * ---------------------------------------------------------------------------
 * REDIS-COST-01 — why this was rewritten
 * ---------------------------------------------------------------------------
 * The previous implementation used a sorted-set sliding window: every single
 * request ran a Lua script that issued ZREMRANGEBYSCORE + ZCARD + ZADD +
 * PEXPIRE (four commands) AND stored a unique ~40-byte member per request. At
 * the `apiRead` preset of 300 requests/minute that is up to 12 KB of Redis
 * memory per active user per minute, purely to count. It was simultaneously
 * our second-largest command consumer and our largest storage consumer.
 *
 * Two changes fix that:
 *
 * 1. TIERING. Not every limit is a security control. `apiRead` at 300/min and
 *    the various vote limiters exist to stop runaway clients and accidental
 *    loops, not determined attackers — and each underlying action is
 *    independently protected (votes by unique constraints, reads by being
 *    reads). Those limiters now run entirely in-process (`tier: "local"`) and
 *    cost ZERO Redis commands. Limiters that genuinely gate abuse — auth,
 *    PIN, registration, payouts, purchases, gifting, writes — stay exact
 *    (`tier: "exact"`) and still hit Redis.
 *
 * 2. A CHEAPER EXACT ALGORITHM. Exact limiters use an approximate sliding
 *    window built from two fixed-window counters (the current window and the
 *    previous one, weighted by how far through the current window we are).
 *    This is the standard Cloudflare-style approximation. It costs an MGET +
 *    an INCR (+ a PEXPIRE only when a window is first created) — two to three
 *    commands instead of four — and stores two small integers per subject
 *    instead of one member per request. Crucially it does NOT reintroduce the
 *    2x boundary burst that BUG-RATE-01 fixed: weighting the previous window's
 *    count is precisely what smooths the boundary.
 *
 * Both tiers keep the in-process L1 skip cache, which lets an instance avoid
 * Redis entirely while a subject is far below its limit.
 *
 * All state transitions execute inside a single Lua script, so there is no
 * TOCTOU race between concurrent serverless instances.
 */

import { redis } from "@/lib/redis";
import { ApiError, tooManyRequests } from "@/lib/api/errors";
import { memGet, memSet } from "@/lib/cache/memory";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for configuring a rate-limit window. */
export interface RateLimitOptions {
  /** Maximum number of requests allowed within the window. */
  limit: number;
  /** Duration of the sliding window in milliseconds. */
  windowMs: number;
  /**
   * Human-readable identifier for this limiter (used in Redis key prefix
   * and error messages). E.g. "auth:google", "xp:award".
   */
  name: string;
  /**
   * Optional endpoint-level global cap (requests per 60 s across all users).
   * Applied after the per-user/IP check in enforceRateLimit.
   * Set on sensitive endpoints (payment, auth, payout) to bound total traffic.
   */
  globalLimit?: number;
  /**
   * When true, skip the in-process L1 counter cache and always hit Redis.
   * Use on sensitive endpoints (auth, PIN, payment) where multi-instance over-
   * counting from the per-process cache would be unacceptable.
   * Equivalent to setting `skipThreshold: 0`.
   */
  bypassL1?: boolean;
  /**
   * BUG-013 FIX: Override the global `RL_SKIP_THRESHOLD` for this endpoint.
   * Fraction of the limit below which in-process counting may skip the Redis
   * round-trip. Set to 0 to always hit Redis (same effect as `bypassL1: true`).
   * Defaults to `RL_SKIP_THRESHOLD` (0.1) when not set.
   *
   * Security-sensitive endpoints (auth, login, OTP, payment) should use 0.
   * Read-only endpoints may use the default to reduce Redis load.
   * Ignored entirely when `tier` is "local" (which never touches Redis).
   */
  skipThreshold?: number;
  /**
   * REDIS-COST-01 — how much this limit is worth paying Redis for.
   *
   * - "exact" (default): counted in Redis, so the limit holds across every
   *   serverless instance. Use for anything an attacker would benefit from
   *   exceeding: authentication, PIN entry, registration, payouts, purchases,
   *   gifting, and writes generally.
   *
   * - "local": counted per serverless instance only, costing ZERO Redis
   *   commands. The effective ceiling becomes roughly `limit x N` where N is
   *   the number of warm instances, so only use it where exceeding the limit
   *   is a nuisance rather than a vulnerability — high-volume reads and idempotent
   *   votes whose underlying action is already constrained elsewhere (unique
   *   indexes, ownership checks). This is where the bulk of our request volume
   *   lives, so moving it off Redis is most of the saving.
   */
  tier?: "exact" | "local";
}

/** Result of a rate-limit check. */
export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** How many requests remain in the current window. */
  remaining: number;
  /** Unix timestamp (ms) when the window resets. */
  resetAt: number;
}

// ---------------------------------------------------------------------------
// Preset limits for common endpoint categories
// ---------------------------------------------------------------------------

/** Rate limit presets – import these in route handlers for consistency. */
export const RATE_LIMITS = {
  /** OAuth initiation / callback endpoints. */
  auth: { limit: 20, windowMs: 15 * 60 * 1000, name: "auth", globalLimit: 1000, bypassL1: true } as RateLimitOptions,
  /**
   * General authenticated API reads. The highest-volume limiter in the app by a
   * wide margin, and the least security-relevant — it exists to catch runaway
   * clients, not attackers. Counted locally so it costs no Redis (REDIS-COST-01).
   */
  apiRead: { limit: 300, windowMs: 60 * 1000, name: "api:read", tier: "local" } as RateLimitOptions,
  /** General authenticated API mutations. */
  apiWrite: { limit: 60, windowMs: 60 * 1000, name: "api:write" } as RateLimitOptions,
  /** Sending messages — room or DM. Dedicated limit, not shared with other writes. */
  messageSend: { limit: 20, windowMs: 60 * 1000, name: "msg:send" } as RateLimitOptions,
  /** XP award (internal service endpoint). */
  xpAward: { limit: 500, windowMs: 60 * 1000, name: "xp:award" } as RateLimitOptions,
  /** Onboarding endpoints (low limit, one-time flow). */
  onboarding: { limit: 30, windowMs: 10 * 60 * 1000, name: "onboarding" } as RateLimitOptions,
  /** Admin operations. bypassL1 ensures multi-instance over-counting can't exceed the limit. */
  admin: { limit: 120, windowMs: 60 * 1000, name: "admin", bypassL1: true } as RateLimitOptions,
  /** PIN verification — tight limit to prevent brute-force of 4-digit keyspace (BUG-14). */
  pinVerify: { limit: 5, windowMs: 15 * 60 * 1000, name: "pin:verify", bypassL1: true } as RateLimitOptions,
  /** Gift sending — separate hourly limit to prevent gift spam / draining (STRUC-09). */
  giftSend: { limit: 50, windowMs: 60 * 60 * 1000, name: "gift:send", bypassL1: true } as RateLimitOptions,
  /** Coin purchase — hourly limit on purchase initiations (STRUC-09). */
  coinPurchase: { limit: 10, windowMs: 60 * 60 * 1000, name: "coin:purchase", globalLimit: 1000, bypassL1: true } as RateLimitOptions,
  /** Payout request — daily limit to prevent abuse of the payout system (STRUC-09). */
  payoutRequest: { limit: 3, windowMs: 24 * 60 * 60 * 1000, name: "payout:request", globalLimit: 1000, bypassL1: true } as RateLimitOptions,
  /** Star gifting — hourly limit (STRUC-09). bypassL1 ensures every star gift hits Redis. */
  starGift: { limit: 30, windowMs: 60 * 60 * 1000, name: "star:gift", bypassL1: true } as RateLimitOptions,
  /** Starting a game play session. */
  gameStart: { limit: 60, windowMs: 60 * 1000, name: "game:start" } as RateLimitOptions,
  /** Submitting a game score — bounds reward farming on client-reported scores. */
  gameScore: { limit: 60, windowMs: 60 * 1000, name: "game:score" } as RateLimitOptions,
  /** Phone-book cross-reference — tight limit to prevent bulk contact enumeration. */
  contactsLookup: { limit: 5, windowMs: 60 * 1000, name: "contacts:lookup", bypassL1: true } as RateLimitOptions,
  /** Crypto payment status polling — client polls every few seconds while
   *  waiting on the confirmation screen; each poll can trigger a chain RPC
   *  call, so this is tighter than apiRead. */
  cryptoStatusPoll: { limit: 40, windowMs: 60 * 1000, name: "crypto:status", bypassL1: true } as RateLimitOptions,
  /** Crypto price-feed reads (checkout amount computation) — bounds how
   *  often a live CoinGecko/DexScreener fetch can be triggered per user. */
  cryptoPriceRead: { limit: 20, windowMs: 60 * 1000, name: "crypto:price", bypassL1: true } as RateLimitOptions,
  // BUG-060 FIX: separate rate limit presets for auth flows. bypassL1 is set on all
  // auth endpoints so multi-instance L1 over-counting cannot allow excess attempts.
  /** OAuth initiation (e.g. /api/auth/google) — low limit; bypassL1 for accuracy. */
  oauthInit: { limit: 10, windowMs: 15 * 60 * 1000, name: "oauth:init", bypassL1: true } as RateLimitOptions,
  /** OAuth callback (e.g. /api/auth/google/callback) — slightly higher; bypassL1. */
  oauthCallback: { limit: 20, windowMs: 15 * 60 * 1000, name: "oauth:callback", bypassL1: true } as RateLimitOptions,
  /** Email/password login — bypassL1 so brute-force is never under-counted. */
  login: { limit: 15, windowMs: 15 * 60 * 1000, name: "auth:login", bypassL1: true } as RateLimitOptions,
  /** Login attempts against an account already known to be suspended/banned —
   *  tighter than `login` so someone can't hammer the endpoint repeatedly
   *  after already having seen the suspension/ban notice (keyed by userId,
   *  once identity is established via OAuth). bypassL1 for accuracy. */
  loginBlocked: { limit: 5, windowMs: 15 * 60 * 1000, name: "auth:login-blocked", bypassL1: true } as RateLimitOptions,
  /** New account registration — tight hourly limit; bypassL1. */
  register: { limit: 5, windowMs: 60 * 60 * 1000, name: "auth:register", bypassL1: true } as RateLimitOptions,
  /** Posting a forum question or answer. */
  forumWrite: { limit: 10, windowMs: 60 * 1000, name: "forum:write" } as RateLimitOptions,
  /** Voting or favoriting a forum question/answer. Idempotent and guarded by a unique index, so counted locally. */
  forumVote: { limit: 60, windowMs: 60 * 1000, name: "forum:vote", tier: "local" } as RateLimitOptions,
  /** Publishing/editing a blog post, or posting a comment. */
  blogWrite: { limit: 15, windowMs: 60 * 1000, name: "blog:write" } as RateLimitOptions,
  /** Liking, subscribing, or recording a view on a blog/post. Idempotent, counted locally. */
  blogVote: { limit: 60, windowMs: 60 * 1000, name: "blog:vote", tier: "local" } as RateLimitOptions,
  /** Creating a poll, quiz, or funding a reward pot. */
  pollQuizWrite: { limit: 10, windowMs: 60 * 1000, name: "pollquiz:write" } as RateLimitOptions,
  /** Voting on a poll or submitting a quiz attempt/share. Attempt caps are enforced in the DB, so counted locally. */
  pollQuizVote: { limit: 60, windowMs: 60 * 1000, name: "pollquiz:vote", tier: "local" } as RateLimitOptions,
  /** Listing or revoking active sessions (BUG-CAP-06) — touches auth state, bypassL1. */
  sessionManage: { limit: 30, windowMs: 60 * 1000, name: "session:manage", bypassL1: true } as RateLimitOptions,
  /** Creating a wiki, or creating/editing a wiki page. */
  wikiWrite: { limit: 20, windowMs: 60 * 1000, name: "wiki:write" } as RateLimitOptions,
  /** Sharing a wiki, or managing moderators/invites/collaborators. Ownership-checked, so counted locally. */
  wikiVote: { limit: 60, windowMs: 60 * 1000, name: "wiki:vote", tier: "local" } as RateLimitOptions,
  /** Classroom community posts/comments, events and moderation actions. */
  classroomWrite: { limit: 20, windowMs: 60 * 1000, name: "classroom:write" } as RateLimitOptions,
  /** Classroom likes / lesson completions. Idempotent and unique-index guarded, so counted locally. */
  classroomVote: { limit: 60, windowMs: 60 * 1000, name: "classroom:vote", tier: "local" } as RateLimitOptions,
  /** Classroom slug changes — money-moving and SEO-affecting, so tight and exact (bypassL1). */
  classroomSlugChange: { limit: 5, windowMs: 60 * 60 * 1000, name: "classroom:slug", bypassL1: true } as RateLimitOptions,
  /** Referral link visit recording — anonymous, IP-scoped. Idempotent (unique index on
   * referrer+visitor+day in Postgres), so it's counted locally rather than hitting Redis on
   * every page load that carries a `?r=` param. */
  referralVisit: { limit: 30, windowMs: 60 * 1000, name: "referral:visit", tier: "local" } as RateLimitOptions,
} as const;

// ---------------------------------------------------------------------------
// Exact tier: approximate sliding window over two fixed-window counters
// ---------------------------------------------------------------------------

/**
 * Atomic approximate-sliding-window limiter (REDIS-COST-01).
 *
 * The window is divided into fixed buckets of `windowMs`. We keep a plain
 * integer counter per bucket and estimate the number of requests in the last
 * `windowMs` as:
 *
 *     estimate = previousBucketCount * (1 - elapsedRatio) + currentBucketCount
 *
 * where `elapsedRatio` is how far through the current bucket we are (0 to 1).
 * At the instant a bucket rolls over, the previous bucket still contributes its
 * full weight, so there is no boundary burst — which is the property
 * BUG-RATE-01 originally introduced the sorted set to get. As the current
 * bucket fills, the previous one fades out proportionally.
 *
 * Cost: MGET (1) + INCR (1) + PEXPIRE (only when a bucket is created) — two to
 * three commands, versus four for the sorted set, and two small integers of
 * storage per subject instead of one ~40-byte member per request.
 *
 * KEYS[1] = current bucket counter key
 * KEYS[2] = previous bucket counter key
 * ARGV[1] = limit
 * ARGV[2] = bucket TTL in ms (two windows, so the previous bucket outlives its
 *           usefulness by exactly one window and then expires on its own)
 * ARGV[3] = elapsedRatio within the current bucket, 0..1
 * ARGV[4] = ms remaining in the current bucket
 *
 * Returns: {allowed, remaining, resetMs}
 */
const SLIDING_COUNTER_LUA = `
local curKey = KEYS[1]
local prevKey = KEYS[2]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local elapsed = tonumber(ARGV[3])
local resetMs = tonumber(ARGV[4])

local vals = redis.call('MGET', curKey, prevKey)
local cur = tonumber(vals[1]) or 0
local prev = tonumber(vals[2]) or 0

local estimate = prev * (1 - elapsed) + cur
if estimate >= limit then
  return {0, 0, resetMs}
end

cur = redis.call('INCR', curKey)
if cur == 1 then
  redis.call('PEXPIRE', curKey, ttl)
end

local remaining = math.floor(limit - (prev * (1 - elapsed) + cur))
if remaining < 0 then remaining = 0 end
return {1, remaining, resetMs}
`;

/**
 * Build the pair of bucket keys for a subject at a point in time.
 *
 * The variable part of the key is wrapped in a `{...}` hash tag so that both
 * buckets always land in the same Redis Cluster slot. A Lua script may only
 * touch keys in one slot, so without the tag this would break on a clustered
 * ioredis deployment (Upstash is single-slot, but the abstraction has to work
 * for both providers).
 */
function bucketKeys(baseKey: string, windowMs: number, now: number): {
  current: string;
  previous: string;
  elapsedRatio: number;
  resetMs: number;
} {
  const bucket = Math.floor(now / windowMs);
  const bucketStart = bucket * windowMs;
  const elapsedRatio = (now - bucketStart) / windowMs;
  return {
    current: `{${baseKey}}:${bucket}`,
    previous: `{${baseKey}}:${bucket - 1}`,
    elapsedRatio,
    resetMs: bucketStart + windowMs - now,
  };
}

// ---------------------------------------------------------------------------
// In-process rate-limit caches
// ---------------------------------------------------------------------------

/**
 * Per-key in-process counter used to skip Redis when well under limit, and as
 * the sole counter for `tier: "local"` limiters.
 */
interface RlMemEntry {
  count: number;
  windowStart: number;
}

/** How long to trust the in-memory counter before re-syncing with Redis (ms). */
const RL_MEM_TTL_MS = 2_000;

/**
 * Fraction of the limit below which we can safely skip the Redis round-trip.
 * BUG-16: lowered from 0.7 to 0.4; BUG-RL-01: further lowered to 0.25;
 * BUG-021 FIX: further lowered to 0.1.
 *
 * Multi-instance overage formula: N x L1% x limit
 * At 0.1 with N=3 serverless instances: each instance allows up to 10% of the
 * limit before hitting Redis. Burst headroom = 3 x 0.1 x limit = 30% of limit
 * before Redis cuts in. This tighter threshold reduces multi-instance over-counting
 * while still saving Redis round-trips on low-traffic endpoints.
 * For zero-tolerance endpoints use bypassL1: true.
 */
const RL_SKIP_THRESHOLD = 0.1;

// ---------------------------------------------------------------------------
// Local tier
// ---------------------------------------------------------------------------

/**
 * Count a request against a purely in-process fixed window (REDIS-COST-01).
 *
 * Costs no Redis commands at all. The counter is keyed by window bucket so it
 * resets cleanly rather than drifting, and it lives in the shared LRU memory
 * cache, so a cold or recycled instance simply starts a fresh window.
 *
 * Because each instance counts independently, the real ceiling is
 * `limit x (number of warm instances)`. That is an accepted, documented
 * trade — see the `tier` docs on RateLimitOptions for when it is appropriate.
 */
function localWindowCheck(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const bucket = Math.floor(now / options.windowMs);
  const bucketStart = bucket * options.windowMs;
  const resetAt = bucketStart + options.windowMs;
  const memKey = `rl_local:${key}:${bucket}`;

  const entry = memGet<RlMemEntry>(memKey);
  const count = entry ? entry.count : 0;

  if (count >= options.limit) {
    return { allowed: false, remaining: 0, resetAt };
  }

  memSet<RlMemEntry>(
    memKey,
    { count: count + 1, windowStart: bucketStart },
    // Live exactly to the end of the window; the LRU prune sweeps the rest.
    Math.max(1, resetAt - now)
  );

  return { allowed: true, remaining: options.limit - count - 1, resetAt };
}

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

/**
 * Check and record a request in the window for the given key.
 *
 * @param key     - Full Redis key for this limiter + subject combination
 * @param options - Window configuration
 * @returns Rate limit result
 */
async function slidingWindowCheck(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  // Local tier never touches Redis.
  if (options.tier === "local") {
    return localWindowCheck(key, options);
  }

  const now = Date.now();

  // In-process fast-path: if we've checked Redis recently AND the in-process
  // count is well below the limit, skip the Redis round-trip entirely.
  // BUG-16: skip fast-path when bypassL1 is set (sensitive endpoints like auth/PIN)
  // BUG-013 FIX: also skip when skipThreshold is explicitly 0
  // BUG-069 FIX: clamp skipThreshold to [0, 1] so invalid caller-supplied values
  // (negative or >1) don't cause the L1 fast-path to behave unexpectedly.
  const rawThreshold = options.skipThreshold ?? RL_SKIP_THRESHOLD;
  const effectiveSkipThreshold = options.bypassL1 ? 0 : Math.min(Math.max(rawThreshold, 0), 1);
  const memKey = `rl_mem:${key}`;
  const memEntry = memGet<RlMemEntry>(memKey);
  if (effectiveSkipThreshold > 0 && memEntry && (now - memEntry.windowStart) < RL_MEM_TTL_MS) {
    const inMemCount = memEntry.count;
    if (inMemCount < options.limit * effectiveSkipThreshold) {
      // Increment in-process count only; skips Redis entirely for this request
      memSet<RlMemEntry>(memKey, { count: inMemCount + 1, windowStart: memEntry.windowStart }, RL_MEM_TTL_MS);
      return {
        allowed: true,
        remaining: options.limit - inMemCount - 1,
        resetAt: now + options.windowMs,
      };
    }
  }

  const { current, previous, elapsedRatio, resetMs } = bucketKeys(key, options.windowMs, now);

  let allowed = 1;
  let remaining = options.limit - 1;
  let resetAt = now + resetMs;

  try {
    const result = (await redis.eval(
      SLIDING_COUNTER_LUA,
      2,
      current,
      previous,
      String(options.limit),
      String(options.windowMs * 2),
      elapsedRatio.toFixed(6),
      String(resetMs)
    )) as [number, number, number];

    [allowed, remaining] = result;
    resetAt = now + result[2];
  } catch (err) {
    // Redis unavailable. Fail OPEN for ordinary limiters so a cache outage does
    // not take the whole app down, but fail CLOSED for limiters explicitly
    // marked `bypassL1` — those are the security-critical ones (auth, PIN,
    // payouts), where allowing unbounded attempts is worse than a brief outage.
    logger.error({ err, limiter: options.name }, "[rateLimit] Redis check failed");
    if (options.bypassL1) {
      return { allowed: false, remaining: 0, resetAt };
    }
    return { allowed: true, remaining: options.limit - 1, resetAt };
  }

  // Seed the in-process cache with the real count from Redis so subsequent
  // requests in this instance can skip the round-trip.
  if (allowed === 1) {
    const currentCount = options.limit - remaining;
    memSet<RlMemEntry>(memKey, { count: currentCount, windowStart: now }, RL_MEM_TTL_MS);
  }

  return { allowed: allowed === 1, remaining, resetAt };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check rate limit for a specific user by their UUID.
 *
 * @param userId  - Authenticated user's UUID
 * @param options - Rate limit configuration
 * @returns Rate limit result
 */
export async function checkUserRateLimit(
  userId: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const key = `rl:user:${options.name}:${userId}`;
  return slidingWindowCheck(key, options);
}

/**
 * Check rate limit for a specific IP address.
 *
 * @param ip      - Client IP address (from trusted headers)
 * @param options - Rate limit configuration
 * @returns Rate limit result
 */
export async function checkIpRateLimit(
  ip: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const key = `rl:ip:${options.name}:${ip}`;
  return slidingWindowCheck(key, options);
}

/**
 * Enforce a rate limit, throwing a 429 ApiError if the limit is exceeded.
 * Convenience wrapper around `checkIpRateLimit` / `checkUserRateLimit`.
 *
 * @param subject  - User UUID or IP address to key the limit on
 * @param type     - "user" or "ip"
 * @param options  - Rate limit configuration
 * @throws {ApiError} 429 if rate limit exceeded
 */
export async function enforceRateLimit(
  subject: string,
  type: "user" | "ip",
  options: RateLimitOptions
): Promise<void> {
  // FIX-M01: requests with no resolvable IP share a strict sentinel bucket
  // instead of bypassing rate limiting entirely. Uses a very tight quota so
  // that unauthenticated endpoints are not open to anonymous flooding.
  if (type === "ip" && subject === "unknown") {
    const sentinelOptions: RateLimitOptions = { ...options, limit: Math.min(options.limit, 10), name: `${options.name}:unknown_ip` };
    const sentinelResult = await checkIpRateLimit("unknown", sentinelOptions);
    if (!sentinelResult.allowed) {
      throw tooManyRequests(
        `Rate limit exceeded for ${options.name} (unresolvable IP). Try again later.`
      );
    }
    return;
  }

  const result =
    type === "user"
      ? await checkUserRateLimit(subject, options)
      : await checkIpRateLimit(subject, options);

  if (!result.allowed) {
    const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    throw new ApiError(
      429,
      "RATE_LIMITED",
      `Rate limit exceeded for ${options.name}. Try again after ${new Date(result.resetAt).toISOString()}.`,
      undefined,
      {
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Limit": String(options.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
      }
    );
  }

  // Global endpoint cap — applied after the per-user/IP check.
  //
  // BUG-RATE-01 originally replaced a naive fixed-window INCR+EXPIRE here to
  // eliminate the 2x burst at window boundaries. REDIS-COST-01 keeps that
  // property while dropping the sorted set: the same two-counter approximate
  // sliding window used above smooths the boundary without storing a member per
  // request. This key is written by every request to a globally-capped endpoint
  // across the whole fleet, so it was the single hottest write in the app.
  if (options.globalLimit) {
    const globalResult = await slidingWindowCheck(`rate:global:${options.name}`, {
      limit: options.globalLimit,
      windowMs: 60_000, // fixed 60-second global window
      name: `global:${options.name}`,
      // Never skip Redis for a fleet-wide cap: a per-instance counter cannot
      // meaningfully approximate a global one.
      bypassL1: true,
      tier: "exact",
    });

    if (!globalResult.allowed) {
      throw tooManyRequests(
        `Global rate limit exceeded for ${options.name}. Please try again later.`
      );
    }
  }
}

/**
 * Extract the trusted client IP from a Next.js Request object.
 *
 * Priority:
 *   1. x-vercel-forwarded-for — set by Vercel's edge network to the actual
 *      client IP; non-spoofable on Vercel deployments.
 *   2. x-real-ip — set by nginx and other trusted reverse proxies upstream.
 *   3. x-forwarded-for — parsed using TRUSTED_PROXY_COUNT to select the
 *      correct entry and avoid spoofing.
 *
 * TRUSTED_PROXY_COUNT (env var, default 1):
 *   The number of trusted reverse proxy hops that sit between the internet
 *   and this application server. The client IP is selected from the
 *   X-Forwarded-For list at position (totalEntries - TRUSTED_PROXY_COUNT)
 *   from the left (i.e. nth entry from the right, where n = TRUSTED_PROXY_COUNT).
 *   If the list has fewer entries than TRUSTED_PROXY_COUNT, the leftmost entry
 *   is used as a safe fallback.
 *
 *   Example with TRUSTED_PROXY_COUNT=2 and header "1.2.3.4, 10.0.0.1, 10.0.0.2":
 *     - index = 3 - 2 = 1  →  "10.0.0.1" (the entry added by the outermost trusted proxy)
 *
 *   Set to 0 to trust the raw rightmost entry (same as the old behaviour).
 *   Set to 1 (default) when there is exactly one trusted proxy in front of the app.
 *
 * @param request - Incoming Next.js request
 * @returns IP string (falls back to "unknown" if not determinable)
 */
export function getClientIp(request: Request): string {
  // BUG-24: only trust x-vercel-forwarded-for when actually deployed on Vercel
  // — otherwise clients can spoof this header to bypass IP-based rate limiting
  if (process.env.VERCEL === "1") {
    const vercelIp = request.headers.get("x-vercel-forwarded-for");
    if (vercelIp) return vercelIp.split(",")[0].trim();
  }

  // BUG-IP-01: x-real-ip is only trusted in non-production environments
  // (local dev, staging) or when explicitly opted in via TRUST_X_REAL_IP=1.
  // In production on non-Vercel deployments, clients can spoof this header
  // to bypass IP-based rate limiting. Rely on x-forwarded-for instead.
  if (process.env.NODE_ENV !== 'production' || process.env.TRUST_X_REAL_IP === '1') {
    const realIp = request.headers.get("x-real-ip");
    if (realIp) return realIp.trim();
  }

  // Fallback: parse X-Forwarded-For using TRUSTED_PROXY_COUNT so that the
  // rightmost entry (appended by the closest trusted proxy) is not blindly
  // trusted when there are multiple proxies in the chain.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const ips = forwarded.split(",").map((ip) => ip.trim()).filter(Boolean);
    if (ips.length > 0) {
      // TRUSTED_PROXY_COUNT: number of trusted proxy hops (default 1).
      // Select the IP at position (total - trustedCount) from the left,
      // falling back to the leftmost entry if the list is too short.
      const trustedProxyCount = Math.max(
        0,
        parseInt(process.env.TRUSTED_PROXY_COUNT ?? "1", 10)
      );
      if (trustedProxyCount >= ips.length) {
        logger.warn(`[rateLimit] TRUSTED_PROXY_COUNT (${trustedProxyCount}) exceeds XFF depth (${ips.length}); falling back to leftmost IP`);
      }
      const index = Math.max(0, ips.length - trustedProxyCount - 1);
      return ips[index];
    }
  }

  return "unknown";
}

/**
 * Extract the client's User-Agent header for session-device display (the
 * "Active sessions" list in Settings → Security). Every login pathway
 * (Google, Telegram, 2FA verify, session restore, mobile-bridge exchange,
 * admin impersonation) should pass this into `createSession`/`rotateSession`
 * — omitting it is why sessions used to always show as "Unknown device".
 */
export function getUserAgent(request: Request): string | undefined {
  return request.headers.get("user-agent") ?? undefined;
}
