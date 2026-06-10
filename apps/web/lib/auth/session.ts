/**
 * lib/auth/session.ts
 *
 * Session management combining JWT tokens with Redis-backed invalidation.
 *
 * Strategy:
 *   1. On login  – issue access + refresh tokens, write session metadata to Redis
 *   2. On request – verify access token, then confirm session is still valid in Redis
 *   3. On refresh – verify refresh token, check Redis, issue new access token
 *   4. On logout  – delete Redis session key (invalidates all tokens for that session)
 *
 * Redis key schema:
 *   session:{sid}        → JSON session record (TTL = refresh token lifetime)
 *   user_sessions:{uid}  → Set of active sids for a user (for bulk logout)
 */

import { redis } from "@/lib/redis";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  ADMIN_ACCESS_TOKEN_TTL_SECONDS,
  ADMIN_REFRESH_TOKEN_TTL_SECONDS,
  type AccessTokenPayload,
} from "./jwt";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Data stored in Redis for each active session. */
export interface SessionRecord {
  uid: string;
  sid: string;
  email: string;
  username: string;
  is_admin: boolean;
  created_at: string;  // ISO-8601
  /** IP address at login time (for audit). */
  ip?: string;
  /** User-agent at login time. */
  ua?: string;
}

/** Result of a successful login or token refresh. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

// ---------------------------------------------------------------------------
// Redis key builders
// ---------------------------------------------------------------------------

const sessionKey = (sid: string) => `session:${sid}`;
const userSessionsKey = (uid: string) => `user_sessions:${uid}`;

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

/**
 * Create a new authenticated session for a user.
 * Writes session metadata to Redis and issues JWT tokens.
 *
 * @param user    - Minimal user record from the database
 * @param options - Optional IP / UA for audit logging
 * @returns Signed access + refresh token pair
 */
export async function createSession(
  user: {
    id: string;
    email: string;
    username: string;
    is_admin: boolean;
  },
  options: { ip?: string; ua?: string; adminSession?: boolean } = {}
): Promise<AuthTokens> {
  const sid = randomUUID();
  const accessTtl = options.adminSession ? ADMIN_ACCESS_TOKEN_TTL_SECONDS : ACCESS_TOKEN_TTL_SECONDS;
  const refreshTtl = options.adminSession ? ADMIN_REFRESH_TOKEN_TTL_SECONDS : REFRESH_TOKEN_TTL_SECONDS;

  const record: SessionRecord = {
    uid: user.id,
    sid,
    email: user.email,
    username: user.username,
    is_admin: user.is_admin,
    created_at: new Date().toISOString(),
    ip: options.ip,
    ua: options.ua,
  };

  // Write session with TTL matching the refresh token lifetime
  await redis.setex(
    sessionKey(sid),
    refreshTtl,
    JSON.stringify(record)
  );

  // Track session in per-user set; refresh TTL so the set expires if the user
  // stops logging in (matches the longest possible session lifetime)
  await redis.sadd(userSessionsKey(user.id), sid);
  await redis.expire(userSessionsKey(user.id), refreshTtl);

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({
      sub: user.id,
      email: user.email,
      username: user.username,
      is_admin: user.is_admin,
      sid,
    }, accessTtl),
    signRefreshToken(user.id, sid, refreshTtl),
  ]);

  return { accessToken, refreshToken, expiresIn: accessTtl };
}

// ---------------------------------------------------------------------------
// Session validation
// ---------------------------------------------------------------------------

/**
 * Check whether the session with the given `sid` is still valid in Redis.
 * Returns the session record or null if expired / invalidated.
 *
 * @param sid - Session ID extracted from a verified JWT
 */
export async function getSession(sid: string): Promise<SessionRecord | null> {
  const raw = await redis.get(sessionKey(sid));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/**
 * Exchange a valid refresh token for a new access token.
 * The refresh token's `sid` must still be present in Redis.
 *
 * @param refreshToken - Raw JWT refresh token string
 * @returns New access token (refresh token is reused until expiry)
 * @throws if the token is invalid, expired, or the session has been revoked
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<Pick<AuthTokens, "accessToken" | "expiresIn">> {
  // Verify the JWT signature and expiry
  const payload = await verifyRefreshToken(refreshToken);

  // Confirm the session still exists in Redis
  const session = await getSession(payload.sid!);
  if (!session) {
    throw new Error("Session has been revoked or has expired");
  }

  const accessToken = await signAccessToken({
    sub: session.uid,
    email: session.email,
    username: session.username,
    is_admin: session.is_admin,
    sid: session.sid,
  });

  return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

// ---------------------------------------------------------------------------
// Session invalidation
// ---------------------------------------------------------------------------

/**
 * Invalidate a single session by deleting its Redis key.
 * The associated JWT tokens will fail validation immediately.
 *
 * @param sid - Session ID to revoke
 * @param uid - User ID (used to clean up the per-user sessions set)
 */
export async function invalidateSession(sid: string, uid: string): Promise<void> {
  await redis.del(sessionKey(sid));
  await redis.srem(userSessionsKey(uid), sid);
}

/**
 * Invalidate ALL sessions for a user (e.g. on password change or account ban).
 *
 * @param uid - User ID
 */
export async function invalidateAllSessions(uid: string): Promise<void> {
  const sids = await redis.smembers(userSessionsKey(uid));
  if (sids.length > 0) {
    await redis.del(...sids.map(sessionKey));
  }
  await redis.del(userSessionsKey(uid));
}

// ---------------------------------------------------------------------------
// Cookie helpers (for Next.js Route Handlers / Server Components)
// ---------------------------------------------------------------------------

/** Name of the httpOnly cookie that stores the refresh token. */
export const REFRESH_TOKEN_COOKIE = "zobia_rt";

/** Name of the httpOnly cookie that stores the access token. */
export const ACCESS_TOKEN_COOKIE = "zobia_at";

/**
 * Build Set-Cookie header values for both tokens.
 *
 * @param tokens - Token pair from createSession / refreshAccessToken
 * @param secure - Whether to set the Secure flag (true in production)
 */
export function buildCookieHeaders(
  tokens: AuthTokens,
  secure = process.env.NODE_ENV === "production"
): { accessCookie: string; refreshCookie: string } {
  const flags = `HttpOnly; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;

  const accessCookie =
    `${ACCESS_TOKEN_COOKIE}=${tokens.accessToken}; ` +
    `Max-Age=${tokens.expiresIn}; ${flags}`;

  const refreshCookie =
    `${REFRESH_TOKEN_COOKIE}=${tokens.refreshToken}; ` +
    `Max-Age=${REFRESH_TOKEN_TTL_SECONDS}; ${flags}`;

  return { accessCookie, refreshCookie };
}

/**
 * Build Set-Cookie header values that clear both auth cookies.
 */
export function buildClearCookieHeaders(): {
  accessCookie: string;
  refreshCookie: string;
} {
  const flags = "HttpOnly; Path=/; SameSite=Lax; Max-Age=0";
  return {
    accessCookie: `${ACCESS_TOKEN_COOKIE}=; ${flags}`,
    refreshCookie: `${REFRESH_TOKEN_COOKIE}=; ${flags}`,
  };
}

export type { AccessTokenPayload };
