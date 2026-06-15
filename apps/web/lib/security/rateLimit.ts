/**
 * lib/security/rateLimit.ts
 *
 * Redis-backed sliding-window rate limiter.
 *
 * Two variants are provided:
 *   - Per-user  – keyed on the authenticated user's UUID
 *   - Per-IP    – keyed on the client's remote IP address
 *
 * The sliding window algorithm keeps a sorted set of request timestamps in
 * Redis. On each request, a single atomic Lua script:
 *   1. Removes entries older than `windowMs` (ZREMRANGEBYSCORE)
 *   2. Counts remaining entries (ZCARD)
 *   3. If count ≥ limit → denies without writing
 *   4. Otherwise adds current timestamp with a unique member (ZADD) and
 *      resets the key TTL (PEXPIRE)
 *
 * All four steps execute atomically — no TOCTOU race, single round-trip.
 */

import { redis } from "@/lib/redis";
import { tooManyRequests } from "@/lib/api/errors";

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
  auth: { limit: 20, windowMs: 15 * 60 * 1000, name: "auth", globalLimit: 1000 } as RateLimitOptions,
  /** General authenticated API reads. */
  apiRead: { limit: 300, windowMs: 60 * 1000, name: "api:read" } as RateLimitOptions,
  /** General authenticated API mutations. */
  apiWrite: { limit: 60, windowMs: 60 * 1000, name: "api:write" } as RateLimitOptions,
  /** Sending messages — room or DM. Dedicated limit, not shared with other writes. */
  messageSend: { limit: 20, windowMs: 60 * 1000, name: "msg:send" } as RateLimitOptions,
  /** XP award (internal service endpoint). */
  xpAward: { limit: 500, windowMs: 60 * 1000, name: "xp:award" } as RateLimitOptions,
  /** Onboarding endpoints (low limit, one-time flow). */
  onboarding: { limit: 30, windowMs: 10 * 60 * 1000, name: "onboarding" } as RateLimitOptions,
  /** Admin operations. */
  admin: { limit: 120, windowMs: 60 * 1000, name: "admin" } as RateLimitOptions,
  /** PIN verification — tight limit to prevent brute-force of 4-digit keyspace (BUG-14). */
  pinVerify: { limit: 5, windowMs: 15 * 60 * 1000, name: "pin:verify" } as RateLimitOptions,
  /** Gift sending — separate hourly limit to prevent gift spam / draining (STRUC-09). */
  giftSend: { limit: 50, windowMs: 60 * 60 * 1000, name: "gift:send" } as RateLimitOptions,
  /** Coin purchase — hourly limit on purchase initiations (STRUC-09). */
  coinPurchase: { limit: 10, windowMs: 60 * 60 * 1000, name: "coin:purchase", globalLimit: 1000 } as RateLimitOptions,
  /** Payout request — daily limit to prevent abuse of the payout system (STRUC-09). */
  payoutRequest: { limit: 3, windowMs: 24 * 60 * 60 * 1000, name: "payout:request", globalLimit: 1000 } as RateLimitOptions,
  /** Star gifting — hourly limit (STRUC-09). */
  starGift: { limit: 30, windowMs: 60 * 60 * 1000, name: "star:gift" } as RateLimitOptions,
} as const;

// ---------------------------------------------------------------------------
// Lua sliding-window script (atomic, single round-trip)
// ---------------------------------------------------------------------------

/**
 * Atomic sorted-set sliding window using Redis Lua eval.
 *
 * KEYS[1]  = rate limit key (sorted set)
 * ARGV[1]  = now (ms, as string)
 * ARGV[2]  = window_start (now - windowMs, as string) — entries older than
 *            this are expired before counting
 * ARGV[3]  = limit (max allowed entries)
 * ARGV[4]  = ttl (windowMs in ms) — key expires after this many ms of
 *            inactivity, ensuring automatic cleanup
 * ARGV[5]  = member — unique string for this request
 *            (prevents score collisions for concurrent same-ms requests)
 *
 * Returns: {allowed, remaining, ttlMs}
 *   allowed  = 1 if the request is permitted, 0 if denied
 *   remaining = slots left after this request (0 when denied)
 *   ttlMs    = milliseconds until the key expires (= reset window)
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_start = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local member = ARGV[5]

-- Remove expired entries from the sorted set
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

-- Count current entries in the window
local count = redis.call('ZCARD', key)

if count >= limit then
  return {0, 0, redis.call('PTTL', key)}
end

-- Add this request as a new entry (score = timestamp ms, member = unique)
redis.call('ZADD', key, now, member)
-- Reset TTL on each add so the key expires when the window goes idle
redis.call('PEXPIRE', key, ttl)

return {1, limit - count - 1, ttl}
`;

// ---------------------------------------------------------------------------
// Core sliding-window implementation
// ---------------------------------------------------------------------------

/**
 * Check and record a request in the sliding window for the given key.
 *
 * @param key     - Full Redis key for this limiter + subject combination
 * @param options - Window configuration
 * @returns Rate limit result
 */
async function slidingWindowCheck(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = now - options.windowMs;
  // Unique member prevents collisions when multiple requests arrive in the
  // same millisecond (identical score would overwrite the same member).
  const member = `${now}-${Math.random().toString(36).slice(2)}`;

  const result = await redis.eval(
    SLIDING_WINDOW_LUA,
    1,
    key,
    String(now),
    String(windowStart),
    String(options.limit),
    String(options.windowMs),
    member
  ) as [number, number, number];

  const [allowed, remaining, ttlMs] = result;
  return {
    allowed: allowed === 1,
    remaining,
    resetAt: now + ttlMs,
  };
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
    throw tooManyRequests(
      `Rate limit exceeded for ${options.name}. Try again after ${new Date(result.resetAt).toISOString()}.`
    );
  }

  // Global endpoint cap — applied after per-user/IP check.
  // Uses an atomic Lua script to increment and conditionally set TTL in a single
  // round-trip, eliminating the INCR + EXPIRE race (RL-GLOBAL-01).
  if (options.globalLimit) {
    const globalKey = `rate:global:${options.name}`;
    const GLOBAL_RATE_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;
    const globalCount = await redis.eval(GLOBAL_RATE_LUA, 1, globalKey, "60") as number;
    if (globalCount > options.globalLimit) {
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

  // x-real-ip is set by nginx and other trusted reverse proxies
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

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
        parseInt(process.env.TRUSTED_PROXY_COUNT ?? "1", 10) || 1
      );
      if (trustedProxyCount >= ips.length) {
        console.warn(`[rateLimit] TRUSTED_PROXY_COUNT (${trustedProxyCount}) exceeds XFF depth (${ips.length}); falling back to leftmost IP`);
      }
      const index = Math.max(0, ips.length - trustedProxyCount - 1);
      return ips[index];
    }
  }

  return "unknown";
}
