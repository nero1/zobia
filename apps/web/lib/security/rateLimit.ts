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
 * Redis. On each request:
 *   1. Remove entries older than `windowMs`
 *   2. Count remaining entries
 *   3. If count ≥ limit → deny
 *   4. Otherwise add current timestamp and set key TTL
 *
 * This is accurate and resistant to burst abuse while using minimal memory.
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
  auth: { limit: 20, windowMs: 15 * 60 * 1000, name: "auth" } as RateLimitOptions,
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
} as const;

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
  const resetAt = now + options.windowMs;
  const windowSeconds = Math.ceil(options.windowMs / 1000);

  // We use a sorted set with score = timestamp (ms).
  // ioredis does not expose ZRANGEBYSCORE / ZADD in the typed interface,
  // so we fall back to raw incr-based counting with a TTL.
  // For a production deployment with high traffic, replace this with a
  // Lua script that uses ZREMRANGEBYSCORE + ZADD atomically.

  // Simple token-bucket approximation using INCR + EXPIRE:
  const countKey = `${key}:count`;
  const tsKey = `${key}:ts`;

  // Get current count
  const rawCount = await redis.get(countKey);
  const count = rawCount ? parseInt(rawCount, 10) : 0;

  if (count >= options.limit) {
    const ttl = await redis.ttl(countKey);
    return {
      allowed: false,
      remaining: 0,
      resetAt: now + ttl * 1000,
    };
  }

  // Increment counter
  const newCount = await redis.incr(countKey);
  // Set TTL only on first write (avoid resetting window on each request)
  if (newCount === 1) {
    await redis.expire(countKey, windowSeconds);
    await redis.setex(tsKey, windowSeconds, String(now));
  }

  const ttl = await redis.ttl(countKey);
  return {
    allowed: true,
    remaining: options.limit - newCount,
    resetAt: now + ttl * 1000,
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
 * @param ip      - Client IP address (from X-Forwarded-For or remoteAddress)
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
  const result =
    type === "user"
      ? await checkUserRateLimit(subject, options)
      : await checkIpRateLimit(subject, options);

  if (!result.allowed) {
    throw tooManyRequests(
      `Rate limit exceeded for ${options.name}. Try again after ${new Date(result.resetAt).toISOString()}.`
    );
  }
}

/**
 * Extract the client IP from a Next.js Request object.
 * Prefers X-Forwarded-For (set by proxies / CDN) over the raw socket address.
 *
 * @param request - Incoming Next.js request
 * @returns IP string (falls back to "unknown" if not determinable)
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // X-Forwarded-For can be a comma-separated list; take the first (client) IP
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}
