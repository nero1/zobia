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
import { randomUUID, createHash } from "crypto";

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
  adminSession?: boolean;
  created_at: string;  // ISO-8601
  /** IP address at login time (for audit). */
  ip?: string;
  /** User-agent at login time. */
  ua?: string;
  refreshTokenHash?: string;
  /** Previous refresh token hash — valid during a short grace window after rotation. */
  prevRefreshTokenHash?: string;
  /** Unix ms timestamp until which prevRefreshTokenHash is accepted (grace window). */
  prevRefreshValidUntil?: number;
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

  // Generate tokens first so we can hash the refresh token into the session record (ZB-24)
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

  const record: SessionRecord = {
    uid: user.id,
    sid,
    email: user.email,
    username: user.username,
    is_admin: user.is_admin,
    adminSession: options.adminSession,
    created_at: new Date().toISOString(),
    ip: options.ip,
    ua: options.ua,
    refreshTokenHash: createHash("sha256").update(refreshToken).digest("hex"), // ZB-24: for rotation detection
  };

  // Write session with TTL matching the refresh token lifetime
  await redis.setex(
    sessionKey(sid),
    refreshTtl,
    JSON.stringify(record)
  );

  // Track session in per-user set; atomically extend TTL only when the new
  // lifetime would exceed the current one (Lua avoids a TTL→EXPIRE TOCTOU race).
  await redis.sadd(userSessionsKey(user.id), sid);
  await redis.eval(
    `local current = redis.call('TTL', KEYS[1])
     local newTtl = tonumber(ARGV[1])
     if current < newTtl then redis.call('EXPIRE', KEYS[1], newTtl) end`,
    1,
    userSessionsKey(user.id),
    String(refreshTtl)
  );

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
): Promise<Pick<AuthTokens, "accessToken" | "expiresIn"> & { newRefreshToken?: string; refreshTtl?: number }> {
  const payload = await verifyRefreshToken(refreshToken);

  const session = await getSession(payload.sid!);
  if (!session) {
    throw new Error("Session has been revoked or has expired");
  }

  // Reuse detection — if session has a stored hash and it doesn't match, check grace window
  if (session.refreshTokenHash) {
    const presentedHash = createHash("sha256").update(refreshToken).digest("hex");
    if (presentedHash !== session.refreshTokenHash) {
      // Check if this is the previous token within its grace window (handles lost responses on mobile)
      const withinGrace =
        session.prevRefreshTokenHash &&
        session.prevRefreshValidUntil &&
        Date.now() < session.prevRefreshValidUntil &&
        presentedHash === session.prevRefreshTokenHash;

      if (!withinGrace) {
        // Genuine token reuse — revoke entire session chain
        await invalidateAllSessions(session.uid).catch(() => {});
        throw new Error("Refresh token reuse detected. All sessions revoked.");
      }
      // Within grace window — treat as if the current token was presented so rotation proceeds
    }
  }

  // ZB-25: Use correct TTL for admin sessions
  const isAdminSession = session.adminSession ?? session.is_admin;
  const accessTtl = isAdminSession ? ADMIN_ACCESS_TOKEN_TTL_SECONDS : ACCESS_TOKEN_TTL_SECONDS;
  const refreshTtl = isAdminSession ? ADMIN_REFRESH_TOKEN_TTL_SECONDS : REFRESH_TOKEN_TTL_SECONDS;

  // ZB-24: Rotate refresh token — issue a new one and update the session record
  const [accessToken, newRefreshToken] = await Promise.all([
    signAccessToken({
      sub: session.uid,
      email: session.email,
      username: session.username,
      is_admin: session.is_admin,
      sid: session.sid,
    }, accessTtl),
    signRefreshToken(session.uid, session.sid, refreshTtl),
  ]);

  // Update session with new refresh token hash; keep previous hash valid for 30s (grace window)
  const newHash = createHash("sha256").update(newRefreshToken).digest("hex");
  const updatedRecord: SessionRecord = {
    ...session,
    refreshTokenHash: newHash,
    prevRefreshTokenHash: session.refreshTokenHash,
    prevRefreshValidUntil: Date.now() + 30_000,
  };
  await redis.setex(sessionKey(session.sid), refreshTtl, JSON.stringify(updatedRecord)).catch(() => {});

  // Extend the per-user session-set TTL so active users don't get evicted (BUG-16)
  await redis.expire(
    userSessionsKey(session.uid),
    refreshTtl
  ).catch(() => {});

  return { accessToken, expiresIn: accessTtl, newRefreshToken, refreshTtl };
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
 * @param tokens     - Token pair from createSession / refreshAccessToken
 * @param secure     - Whether to set the Secure flag (true in production)
 * @param refreshTtl - Max-Age for the refresh cookie in seconds (defaults to
 *                     REFRESH_TOKEN_TTL_SECONDS). Pass the actual TTL so admin
 *                     sessions (1-hour refresh) don't get a 30-day cookie.
 */
export function buildCookieHeaders(
  tokens: AuthTokens,
  secure = process.env.NODE_ENV === "production",
  refreshTtl: number = REFRESH_TOKEN_TTL_SECONDS
): { accessCookie: string; refreshCookie: string } {
  const flags = `HttpOnly; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;

  const accessCookie =
    `${ACCESS_TOKEN_COOKIE}=${tokens.accessToken}; ` +
    `Max-Age=${tokens.expiresIn}; ${flags}`;

  const refreshCookie =
    `${REFRESH_TOKEN_COOKIE}=${tokens.refreshToken}; ` +
    `Max-Age=${refreshTtl}; ${flags}`;

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
