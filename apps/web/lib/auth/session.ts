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
import { memGet, memSet, memDel } from "@/lib/cache/memory";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  REFRESH_TOKEN_TTL_SECONDS,
  type AccessTokenPayload,
} from "./jwt";
import { loadManifest } from "@/lib/manifest";
import { randomUUID, createHash } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Data stored in Redis for each active session. */
export interface SessionRecord {
  uid: string;
  sid: string;
  email: string | null;
  username: string;
  is_admin: boolean;
  adminSession?: boolean;
  is_moderator?: boolean;
  is_creator?: boolean;
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
  /** Seconds until the refresh token expires (used to set refresh cookie maxAge). */
  refreshTtl: number;
}

// ---------------------------------------------------------------------------
// Redis key builders
// ---------------------------------------------------------------------------

const sessionKey = (sid: string) => `session:${sid}`;
const userSessionsKey = (uid: string) => `user_sessions:${uid}`;

// ---------------------------------------------------------------------------
// In-process session cache (L1)
//
// getSession() runs on EVERY authenticated request (the withAuth middleware
// calls it to confirm the session has not been revoked). On chat surfaces that
// poll every few seconds this is the single highest-volume Redis read in the
// app — one GET per request, per user, indefinitely.
//
// We front the Redis GET with a tiny per-instance TTL cache. The trade-off is a
// bounded staleness window: a session revoked on another instance (logout, ban,
// token-reuse) may still be accepted on a warm instance for up to
// SESSION_CACHE_TTL_MS. We keep that window short, invalidate the local entry on
// every revoke/rotate that happens on this instance, and the account-status
// check in withAuth (banned/suspended/deleted) is enforced independently — so a
// banned user is still cut off promptly. Only positive lookups are cached;
// negatives are never cached so a fresh login is visible immediately.
// ---------------------------------------------------------------------------

/** Per-instance TTL for a cached session record (ms). Kept short to bound
 *  the revocation window: a banned/logged-out session is rejected within 3 s. */
const SESSION_CACHE_TTL_MS = 3_000;
const sessionCacheKey = (sid: string) => `sess:${sid}`;

/** Drop the in-process cache entry for a session (after revoke / rotate). */
function evictSessionCache(sid: string): void {
  memDel(sessionCacheKey(sid));
}

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
    email: string | null;
    username: string;
    is_admin: boolean;
    is_moderator?: boolean;
    is_creator?: boolean;
  },
  options: { ip?: string; ua?: string; adminSession?: boolean } = {}
): Promise<AuthTokens> {
  const sid = randomUUID();
  const manifest = await loadManifest();
  const ttlRole = (user.is_admin || options.adminSession) ? "admin"
    : user.is_moderator ? "moderator"
    : user.is_creator   ? "creator"
    : "default";
  const { accessTtl, refreshTtl } = manifest.sessionTtls[ttlRole];

  // Generate tokens first so we can hash the refresh token into the session record (ZB-24)
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({
      sub: user.id,
      email: user.email ?? "",
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
    is_moderator: user.is_moderator,
    is_creator: user.is_creator,
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

  // Track session in per-user sorted set, scored by creation time.
  // Atomically extend TTL only when the new lifetime would exceed the current one
  // (Lua avoids a TTL→EXPIRE TOCTOU race).
  await redis.zadd(userSessionsKey(user.id), Date.now(), sid);
  await redis.eval(
    `local current = redis.call('TTL', KEYS[1])
     local newTtl = tonumber(ARGV[1])
     if current < newTtl then redis.call('EXPIRE', KEYS[1], newTtl) end`,
    1,
    userSessionsKey(user.id),
    String(refreshTtl)
  );

  // Enforce per-user session limit: evict oldest sessions beyond MAX_SESSIONS.
  // Both the session-key deletions and the sorted-set trim run in one atomic
  // pipeline so there is no window where a just-deleted SID still appears in the
  // sorted set (or vice-versa) — SESSION-EVICT-01.
  const MAX_SESSIONS = 10;
  const evictedSids = await redis.zrange(userSessionsKey(user.id), 0, -(MAX_SESSIONS + 1));
  if (evictedSids.length > 0) {
    const pipeline = redis.pipeline();
    for (const sid of evictedSids) {
      evictSessionCache(sid);
      pipeline.del(sessionKey(sid));
    }
    pipeline.zremrangebyrank(userSessionsKey(user.id), 0, -(MAX_SESSIONS + 1));
    await pipeline.exec();
  } else {
    await redis.zremrangebyrank(userSessionsKey(user.id), 0, -(MAX_SESSIONS + 1));
  }

  return { accessToken, refreshToken, expiresIn: accessTtl, refreshTtl };
}

/**
 * Rotate the session ID after successful authentication or 2FA completion.
 * Prevents session fixation by invalidating the pre-auth session and issuing
 * a brand-new session with a new UUID. (BUG-27)
 *
 * @param oldSid  - The pre-auth session ID to invalidate (or "pre_auth" literal)
 * @param user    - Authenticated user record
 * @param options - IP / UA for audit
 * @returns New auth tokens with a fresh session ID
 */
export async function rotateSession(
  oldSid: string | null,
  user: { id: string; email: string | null; username: string; is_admin: boolean; is_moderator?: boolean; is_creator?: boolean },
  options: { ip?: string; ua?: string; adminSession?: boolean } = {}
): Promise<AuthTokens> {
  // Invalidate the old session before creating the new one
  if (oldSid && oldSid !== "pre_auth") {
    await invalidateSession(oldSid, user.id).catch(() => {});
  }
  // Clean up pre-auth Redis key if it exists
  await redis.del(`pre_auth:${user.id}`).catch(() => {});

  return createSession(user, options);
}

// ---------------------------------------------------------------------------
// Session validation
// ---------------------------------------------------------------------------

/**
 * Read a session record straight from Redis, bypassing the L1 cache.
 *
 * Used by the refresh-token rotation path, which compares the presented token's
 * hash against the stored `refreshTokenHash`/`prevRefreshTokenHash`. Those fields
 * change on every rotation, so a stale per-instance copy could make a legitimate
 * rotated token look like a reused one and wrongly revoke the whole session
 * chain. Token rotation is rare relative to ordinary requests, so always paying
 * the Redis read here costs almost nothing.
 */
async function getSessionFresh(sid: string): Promise<SessionRecord | null> {
  const raw = await redis.get(sessionKey(sid));
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as SessionRecord;
    memSet(sessionCacheKey(sid), record, SESSION_CACHE_TTL_MS);
    return record;
  } catch {
    return null;
  }
}

/**
 * Check whether the session with the given `sid` is still valid in Redis.
 * Returns the session record or null if expired / invalidated.
 *
 * @param sid - Session ID extracted from a verified JWT
 */
export async function getSession(sid: string): Promise<SessionRecord | null> {
  // L1: per-instance cache — avoids a Redis round-trip on every authenticated
  // request (see SESSION_CACHE_TTL_MS notes above). Only the existence + stable
  // identity fields are consumed on this path, so brief staleness is safe.
  const cached = memGet<SessionRecord>(sessionCacheKey(sid));
  if (cached) return cached;

  const raw = await redis.get(sessionKey(sid));
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as SessionRecord;
    memSet(sessionCacheKey(sid), record, SESSION_CACHE_TTL_MS);
    return record;
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

  // Read fresh (never the L1 cache): rotation compares token hashes that change
  // on every refresh, so a stale copy could mis-flag a valid token as reused.
  const session = await getSessionFresh(payload.sid!);
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

  const manifest = await loadManifest();
  const ttlRole = (session.adminSession ?? session.is_admin) ? "admin"
    : session.is_moderator ? "moderator"
    : session.is_creator   ? "creator"
    : "default";
  const { accessTtl, refreshTtl } = manifest.sessionTtls[ttlRole];

  // ZB-24: Rotate refresh token — issue a new one and update the session record
  const [accessToken, newRefreshToken] = await Promise.all([
    signAccessToken({
      sub: session.uid,
      ...(session.email ? { email: session.email } : {}),
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
  // Refresh the L1 cache so the rotated record (new hash) is served immediately
  // and the stale pre-rotation copy can never linger on this instance.
  memSet(sessionCacheKey(session.sid), updatedRecord, SESSION_CACHE_TTL_MS);

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
  evictSessionCache(sid);
  await redis.del(sessionKey(sid));
  await redis.zrem(userSessionsKey(uid), sid);
}

/**
 * Invalidate ALL sessions for a user (e.g. on password change or account ban).
 *
 * @param uid - User ID
 */
export async function invalidateAllSessions(uid: string): Promise<void> {
  const sids = await redis.zrange(userSessionsKey(uid), 0, -1);
  if (sids.length > 0) {
    for (const sid of sids) evictSessionCache(sid);
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
  const secure = process.env.NODE_ENV === "production";
  const flags = `HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
  return {
    accessCookie: `${ACCESS_TOKEN_COOKIE}=; ${flags}`,
    refreshCookie: `${REFRESH_TOKEN_COOKIE}=; ${flags}`,
  };
}

export type { AccessTokenPayload };
