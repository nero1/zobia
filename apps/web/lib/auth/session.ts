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
import { db } from "@/lib/db";
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
  // BUG-010 FIX: email is intentionally NOT stored in the session record.
  // Storing email in Redis causes stale values when a user changes their email —
  // all existing sessions would serve the old address until they expire.
  // Email is fetched from the DB on the token-refresh path when needed for the JWT.
  username: string;
  is_admin: boolean;
  adminSession?: boolean;
  is_moderator?: boolean;
  is_support?: boolean;
  is_senior_support?: boolean;
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
  /** Set only on an impersonation session — the admin user id who started it. */
  impersonatedBy?: string;
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

// BUG-005 FIX: reduce L1 cache TTL from 3 s to 500 ms.
// The 3 s window was too wide: a banned user could continue to make requests
// for up to 3 s per warm instance after the ban was applied. 500 ms bounds the
// revocation propagation delay to a single polling cycle on most chat surfaces
// while still saving the majority of per-request Redis reads.
// Account-status checks (banned/suspended/deleted) in withAuth are applied
// regardless of the cached record, so a freshly banned user is already blocked
// on the next status check; this TTL reduction is an additional defence-in-depth
// measure for latency-sensitive invalidation (logout, token rotation).
/** Per-instance TTL for a cached session record (ms). Keeps the revocation window ≤ 500 ms. */
const SESSION_CACHE_TTL_MS = 500;
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
    onboarding_completed?: boolean;
  },
  options: { ip?: string; ua?: string; adminSession?: boolean; impersonatedBy?: string } = {}
): Promise<AuthTokens> {
  const sid = randomUUID();
  const manifest = await loadManifest();

  // Always re-read is_support/is_senior_support fresh from the DB at issuance
  // time, regardless of what (if anything) the caller passed in — this is
  // the single choke point every login/rotate/restore path funnels through,
  // so centralizing the lookup here means the claim can never be stale or
  // client-influenced without touching every call site's own SELECT.
  // Fails closed (both false) on a DB error, matching getStaffRoles().
  let is_support = false;
  let is_senior_support = false;
  try {
    const { rows: staffRows } = await db.query<{ is_support: boolean; is_senior_support: boolean }>(
      `SELECT COALESCE(is_support, false) AS is_support, COALESCE(is_senior_support, false) AS is_senior_support
       FROM users WHERE id = $1 LIMIT 1`,
      [user.id]
    );
    is_support = Boolean(staffRows[0]?.is_support);
    is_senior_support = Boolean(staffRows[0]?.is_senior_support);
  } catch {
    // fail closed — leave both false
  }

  const ttlRole = (user.is_admin || options.adminSession) ? "admin"
    : user.is_moderator ? "moderator"
    : user.is_creator   ? "creator"
    : "default";
  // An impersonation session is deliberately capped short (15 min) regardless
  // of the target's own role — it should not persist like a normal login.
  const { accessTtl, refreshTtl } = options.impersonatedBy
    ? { accessTtl: 900, refreshTtl: 900 }
    : manifest.sessionTtls[ttlRole];

  // Generate tokens first so we can hash the refresh token into the session record (ZB-24)
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({
      sub: user.id,
      email: user.email ?? "",
      username: user.username,
      is_admin: user.is_admin,
      is_moderator: user.is_moderator,
      ...(is_support ? { is_support } : {}),
      ...(is_senior_support ? { is_senior_support } : {}),
      sid,
      ...(typeof user.onboarding_completed === "boolean"
        ? { onboarding_completed: user.onboarding_completed }
        : {}),
      ...(options.impersonatedBy ? { impersonated_by: options.impersonatedBy } : {}),
    }, accessTtl),
    signRefreshToken(user.id, sid, refreshTtl),
  ]);

  const record: SessionRecord = {
    uid: user.id,
    sid,
    // BUG-010 FIX: email is not stored in the Redis session record to prevent
    // sessions from serving stale email addresses after a user changes their email.
    username: user.username,
    is_admin: user.is_admin,
    adminSession: options.adminSession,
    is_moderator: user.is_moderator,
    is_support,
    is_senior_support,
    is_creator: user.is_creator,
    created_at: new Date().toISOString(),
    ip: options.ip,
    ua: options.ua,
    refreshTokenHash: createHash("sha256").update(refreshToken).digest("hex"), // ZB-24: for rotation detection
    impersonatedBy: options.impersonatedBy,
  };

  // Write session with TTL matching the refresh token lifetime
  await redis.setex(
    sessionKey(sid),
    refreshTtl,
    JSON.stringify(record)
  );

  // Record daily login for Creator Fund active-day tracking (BUG-027)
  await db.query(
    `INSERT INTO user_daily_logins (user_id, login_date)
     VALUES ($1, CURRENT_DATE)
     ON CONFLICT (user_id, login_date) DO NOTHING`,
    [user.id]
  ).catch(() => {}); // non-fatal

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
  user: { id: string; email: string | null; username: string; is_admin: boolean; is_moderator?: boolean; is_creator?: boolean; onboarding_completed?: boolean },
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
export async function getSessionFresh(sid: string): Promise<SessionRecord | null> {
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
): Promise<Pick<AuthTokens, "accessToken" | "expiresIn"> & { newRefreshToken?: string; refreshTtl: number }> {
  const payload = await verifyRefreshToken(refreshToken);

  // Read fresh (never the L1 cache): rotation compares token hashes that change
  // on every refresh, so a stale copy could mis-flag a valid token as reused.
  const session = await getSessionFresh(payload.sid!);
  if (!session) {
    throw new Error("Session has been revoked or has expired");
  }

  // AUTH-01: Acquire a distributed lock to prevent concurrent refresh races.
  // The lock key is per-session so concurrent refreshes for DIFFERENT users
  // are not serialised unnecessarily.
  const lockKey = `refresh_lock:${payload.sid}`;
  const lockToken = randomUUID();
  const lockAcquired = await redis.set(lockKey, lockToken, "PX", 10_000, "NX");
  if (!lockAcquired) {
    // Another refresh for this session is in flight. Fail fast — the client
    // should retry once the in-flight refresh resolves.
    throw new Error("Concurrent refresh in progress. Please retry.");
  }

  try {
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

  // BUG-010 FIX: fetch current email from DB (not from the session record) so
  // that access tokens issued during a refresh always carry the up-to-date email
  // address — even if the user changed it after the session was created.
  //
  // Also re-read is_support/is_senior_support fresh here on every refresh
  // (rather than trusting whatever the Redis session record has cached from
  // login time). This is what lets a user who is granted `is_support` after
  // they already have an active session start passing the /gate44/support/*
  // edge pre-filter on their very next token refresh — no forced logout
  // required — mirroring the precedent this fix follows (BUG-010's email
  // freshness) rather than the is_admin/is_moderator pattern above, which
  // instead relies on `downgrade_moderator` explicitly invalidating sessions
  // (there is no equivalent forced-logout wired up for is_support yet, so a
  // fresh-DB-read-on-refresh is the safer default for a newly-added claim).
  const { rows: staffRows } = await db.query<{
    email: string | null;
    is_support: boolean;
    is_senior_support: boolean;
  }>(
    `SELECT email, COALESCE(is_support, false) AS is_support, COALESCE(is_senior_support, false) AS is_senior_support
     FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [session.uid]
  );
  const currentEmail = staffRows[0]?.email ?? null;
  const currentIsSupport = Boolean(staffRows[0]?.is_support);
  const currentIsSeniorSupport = Boolean(staffRows[0]?.is_senior_support);

  // ZB-24: Rotate refresh token — issue a new one and update the session record
  const [accessToken, newRefreshToken] = await Promise.all([
    signAccessToken({
      sub: session.uid,
      ...(currentEmail ? { email: currentEmail } : {}),
      username: session.username,
      is_admin: session.is_admin,
      is_moderator: session.is_moderator,
      ...(currentIsSupport ? { is_support: currentIsSupport } : {}),
      ...(currentIsSeniorSupport ? { is_senior_support: currentIsSeniorSupport } : {}),
      sid: session.sid,
    }, accessTtl),
    signRefreshToken(session.uid, session.sid, refreshTtl),
  ]);

  // Update session with new refresh token hash; keep previous hash valid for 30s (grace window)
  const newHash = createHash("sha256").update(newRefreshToken).digest("hex");
  const updatedRecord: SessionRecord = {
    ...session,
    is_support: currentIsSupport,
    is_senior_support: currentIsSeniorSupport,
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
  } finally {
    // Release the lock (only if we still own it — Lua script for atomicity)
    await redis.eval(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`,
      1,
      lockKey,
      lockToken
    ).catch(() => {});
  }
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

// ---------------------------------------------------------------------------
// Session listing (BUG-CAP-06 — active session management)
// ---------------------------------------------------------------------------

/** A single active session, safe to return to the client (no token hashes). */
export interface SessionSummary {
  sid: string;
  createdAt: string;
  ip: string | null;
  ua: string | null;
  isAdmin: boolean;
}

/**
 * List a user's currently active sessions (most-recently-created first),
 * reading from the same `user_sessions:{uid}` sorted set that session
 * creation/eviction already maintains — see `createSession`'s MAX_SESSIONS
 * eviction above. Never returns `refreshTokenHash` or other internal fields.
 *
 * @param uid - User ID
 */
export async function listUserSessions(uid: string): Promise<SessionSummary[]> {
  const sids = await redis.zrange(userSessionsKey(uid), 0, -1);
  if (sids.length === 0) return [];

  const records = await Promise.all(
    sids.map(async (sid) => {
      const raw = await redis.get(sessionKey(sid));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as SessionRecord;
      } catch {
        return null;
      }
    })
  );

  return records
    .filter((r): r is SessionRecord => r !== null)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map((r) => ({
      sid: r.sid,
      createdAt: r.created_at,
      ip: r.ip ?? null,
      ua: r.ua ?? null,
      isAdmin: r.is_admin,
    }));
}

/**
 * Returns true if `sid` is one of `uid`'s currently tracked active sessions.
 * Used to confirm ownership before revoking a session by ID — a user must
 * never be able to revoke another user's session by guessing/leaking a sid.
 *
 * @param uid - User ID
 * @param sid - Session ID to check
 */
export async function isUsersSession(uid: string, sid: string): Promise<boolean> {
  const sids = await redis.zrange(userSessionsKey(uid), 0, -1);
  return sids.includes(sid);
}

/**
 * Invalidate ALL sessions for a user (e.g. on password change or account ban).
 *
 * @param uid - User ID
 */
export async function invalidateAllSessions(uid: string): Promise<void> {
  const sids = await redis.zrange(userSessionsKey(uid), 0, -1);
  // BUG-SESSION-01: use a pipeline instead of spread so large session counts
  // don't exceed Node.js argument stack limits or ioredis varargs limits.
  const pipeline = redis.pipeline();
  for (const sid of sids) {
    evictSessionCache(sid);
    pipeline.del(sessionKey(sid));
  }
  pipeline.del(userSessionsKey(uid));
  await pipeline.exec();
}

// ---------------------------------------------------------------------------
// Cookie helpers (for Next.js Route Handlers / Server Components)
// ---------------------------------------------------------------------------

/** Name of the httpOnly cookie that stores the refresh token. */
export const REFRESH_TOKEN_COOKIE = "zobia_rt";

/** Name of the httpOnly cookie that stores the access token. */
export const ACCESS_TOKEN_COOKIE = "zobia_at";

/** Cookie pair that stashes an admin's own tokens during impersonation
 *  (see app/api/admin/users/[userId]/impersonate/route.ts and
 *  app/api/auth/impersonate/end/route.ts). */
export const ADMIN_BACKUP_ACCESS_COOKIE = "zobia_admin_at";
export const ADMIN_BACKUP_REFRESH_COOKIE = "zobia_admin_rt";

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
  refreshTtl: number = tokens.refreshTtl
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
