/**
 * lib/api/middleware.ts
 *
 * Shared Next.js Route Handler middleware utilities.
 *
 * Provides higher-order components (HOCs) for:
 *   - Authentication (JWT validation + Redis session check)
 *   - Admin authorization (JWT + database is_admin check)
 *   - Rate limiting
 *   - Zod request body validation
 *
 * Usage:
 * ```ts
 * export const GET = withAuth(async (req, ctx) => {
 *   const user = ctx.user; // AccessTokenPayload
 *   return NextResponse.json({ ok: true });
 * });
 * ```
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z, ZodSchema, ZodType, ZodTypeDef } from "zod";
import {
  verifyAccessToken,
  extractBearerToken,
  type AccessTokenPayload,
} from "@/lib/auth/jwt";
import {
  getSessionFresh,
  invalidateSession,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  type SessionRecord,
} from "@/lib/auth/session";
import {
  ApiError,
  unauthorized,
  forbidden,
  badRequest,
  handleApiError,
} from "@/lib/api/errors";
import {
  enforceRateLimit,
  getClientIp,
  type RateLimitOptions,
} from "@/lib/security/rateLimit";
import {
  isIpAnomalous,
  recordAndCheckAnomaly,
} from "@/lib/security/geoAnomaly";
import { requestContext, logger } from "@/lib/logger";
import { eq, and, isNull, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Context object injected into authenticated handlers. */
export interface AuthContext {
  /** Decoded and validated access token payload. */
  user: AccessTokenPayload;
  /**
   * BUG-SEC-03: Run a database callback inside a transaction where
   * `app.current_user_id` is set via `SET LOCAL` so PostgreSQL RLS
   * policies can reference `current_setting('app.current_user_id', TRUE)`.
   * Uses `SET LOCAL` which is scoped to the transaction and is safe with
   * PgBouncer in transaction-mode pooling.
   */
  withRLS: <T>(fn: (client: DbOrTx) => Promise<T>) => Promise<T>;
}

/** Context object injected into admin handlers. */
export interface AdminContext extends AuthContext {
  /** Confirmed is_admin=true from the database. */
  isAdmin: true;
}

/** Context object injected into moderator-or-admin handlers (e.g. /api/admin/forum/**). */
export interface ModeratorContext extends AuthContext {
  /** Confirmed is_admin from the database. */
  isAdmin: boolean;
  /** Confirmed is_moderator from the database. Always true when isAdmin is false. */
  isModerator: boolean;
}

/** Context object injected into ad-moderator-or-admin handlers (/api/admin/ads/moderation-queue/**). */
export interface AdModeratorContext extends AuthContext {
  /** Confirmed is_admin from the database. */
  isAdmin: boolean;
  /** Confirmed is_ad_moderator from the database. Always true when isAdmin is false. */
  isAdModerator: boolean;
}

/**
 * Authenticated route handler type.
 * Receives the standard Next.js args plus an injected AuthContext.
 */
export type AuthHandler<TParams = Record<string, string>> = (
  req: NextRequest,
  ctx: { params: TParams; auth: AuthContext }
) => Promise<NextResponse | ApiError>;

/**
 * Admin route handler type.
 */
export type AdminHandler<TParams = Record<string, string>> = (
  req: NextRequest,
  ctx: { params: TParams; auth: AdminContext }
) => Promise<NextResponse | ApiError>;

/**
 * Moderator-or-admin route handler type.
 */
export type ModeratorHandler<TParams = Record<string, string>> = (
  req: NextRequest,
  ctx: { params: TParams; auth: ModeratorContext }
) => Promise<NextResponse | ApiError>;

/**
 * Ad-moderator-or-admin route handler type.
 */
export type AdModeratorHandler<TParams = Record<string, string>> = (
  req: NextRequest,
  ctx: { params: TParams; auth: AdModeratorContext }
) => Promise<NextResponse | ApiError>;

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

/**
 * Extract the JWT access token from the request.
 * Checks Authorization header first, then falls back to the HttpOnly cookie.
 *
 * @param req - Incoming Next.js request
 * @returns Raw JWT string or null
 */
function extractToken(req: NextRequest): string | null {
  const bearerToken = extractBearerToken(req.headers.get("authorization"));
  if (bearerToken) return bearerToken;

  return req.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
}

// ---------------------------------------------------------------------------
// Geo-anomaly check helper
// ---------------------------------------------------------------------------

/**
 * Run geo-anomaly detection for a session.
 * Returns true if the check passes (no anomaly or anomaly below threshold),
 * false if the session should be invalidated due to suspicious IP activity.
 *
 * `loginIp` comes from the session record on paths that already read it
 * (admin/moderator routes, sensitive mutations) and from the signed `lip`
 * access-token claim everywhere else — see REDIS-COST-01 in withAuth below.
 * Both are server-controlled values; the client cannot influence either.
 *
 * Note that `recordAndCheckAnomaly` (which does touch Redis) only runs once
 * `isIpAnomalous` returns true, i.e. when the /24 prefix actually changed
 * between two public IPs. That is rare, so this is not a hot-path cost.
 */
async function runGeoAnomalyCheck(
  sid: string,
  uid: string,
  loginIp: string | undefined,
  currentIp: string | undefined
): Promise<boolean> {
  if (loginIp && currentIp && isIpAnomalous(loginIp, currentIp)) {
    const shouldInvalidate = await recordAndCheckAnomaly(sid, uid, loginIp, currentIp);
    if (shouldInvalidate) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Session verification policy (REDIS-COST-01)
// ---------------------------------------------------------------------------

/**
 * Route patterns whose requests must always be checked against live Redis
 * session state and live database account standing, never against the signed
 * access token alone.
 *
 * The rationale: an access token is a bearer credential that stays
 * cryptographically valid until it expires. Reading `session:<sid>` on every
 * single request to catch the small window between a revocation and the
 * token's natural expiry was costing one Redis command per request across the
 * entire app — by far our highest-volume read. We now pay that cost only where
 * acting on a stale credential would be materially harmful: anything that
 * moves money or grants elevated capability.
 *
 * Everything else (feeds, profiles, rooms, leaderboards, chat polling) trusts
 * the signed token for at most one access-token lifetime after revocation.
 * Revocation itself is push-based: every ban/suspend/delete/downgrade path
 * calls `revokeUserAccess`, which destroys the session records immediately, so
 * the next refresh — and every sensitive request in between — fails closed.
 */
const SENSITIVE_PATH_PATTERN =
  /\/(payments|payouts|gifts|coins\/transfer|stars\/gift|economy\/webhooks|economy\/coins\/purchase|economy\/stars\/purchase|economy\/coins\/withdraw|kyc|auth\/2fa|auth\/pin|auth\/sessions|creator\/bank-account)/;

/**
 * Decide whether this request needs live Redis/DB verification.
 *
 * Any non-idempotent request to a sensitive surface qualifies. GET/HEAD
 * requests never do, because reading data you were authorised to read moments
 * ago is not a privilege escalation — with the deliberate exception of
 * `/auth/sessions`, where the response itself is security state.
 *
 * Exported so the classification can be asserted directly in tests — getting it
 * wrong is a security regression, not a performance one, so it is pinned
 * explicitly rather than exercised only through the HOC.
 */
export function requiresLiveVerification(req: NextRequest, pathname: string): boolean {
  if (!SENSITIVE_PATH_PATTERN.test(pathname)) return false;
  if (req.method === "GET" || req.method === "HEAD") {
    return pathname.includes("/auth/sessions");
  }
  return true;
}

/**
 * Confirm, against the database, that an account is still in good standing.
 * Only called on the sensitive paths identified above — the ordinary request
 * path relies on push-based revocation instead (see `revokeUserAccess`).
 *
 * Fails CLOSED: if the account row cannot be read, the request is rejected.
 * A brief database blip is preferable to letting a banned user transact (#20).
 */
async function assertAccountActive(userId: string): Promise<void> {
  let row:
    | {
        is_banned: boolean;
        is_suspended: boolean;
        suspended_until: Date | null;
        deleted_at: Date | null;
      }
    | undefined;
  try {
    const orm = await getDb();
    const rows = await orm
      .select({
        is_banned: sql<boolean>`COALESCE(${schema.users.isBanned}, false)`,
        is_suspended: sql<boolean>`COALESCE(${schema.users.isSuspended}, false)`,
        suspended_until: schema.users.suspendedUntil,
        deleted_at: schema.users.deletedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    row = rows[0];
  } catch {
    throw unauthorized("Account status check failed. Please try again.");
  }

  // BUG-10: an elapsed `suspended_until` means the suspension is over, even if
  // the boolean flag has not been cleared yet.
  const suspensionActive =
    !!row?.is_suspended &&
    (!row.suspended_until || new Date(row.suspended_until) > new Date());

  if (!row || row.deleted_at || row.is_banned || suspensionActive) {
    throw unauthorized("Account is not active. Please contact support.");
  }

  // Clear a stale is_suspended flag whose expiry has passed (fire-and-forget).
  if (row.is_suspended && row.suspended_until && new Date(row.suspended_until) <= new Date()) {
    getDb()
      .then((orm) =>
        orm
          .update(schema.users)
          .set({ isSuspended: false })
          .where(and(eq(schema.users.id, userId), sql`${schema.users.suspendedUntil} <= NOW()`))
      )
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// withAuth HOC
// ---------------------------------------------------------------------------

/**
 * Higher-order component that validates the JWT and injects the user payload
 * into the handler context. Also confirms the session is still valid in Redis.
 *
 * @param handler - Authenticated route handler
 * @returns Next.js compatible route handler
 */
export function withAuth<TParams = Record<string, string>>(
  handler: AuthHandler<TParams>
// `Awaited<TParams>` collapses the Promise so that handlers which annotate
// their ctx as `params: Promise<{…}>` (the Next.js route shape) do not produce
// a doubly-wrapped `Promise<Promise<{…}>>` export that fails Next's route type
// check. Handlers using the resolved `params: {…}` shape are unaffected.
): (req: NextRequest, ctx: { params: Promise<Awaited<TParams>> }) => Promise<NextResponse> {
  return async (req, ctx) => {
    const requestId = randomUUID();
    const route = new URL(req.url).pathname;

    return requestContext.run({ requestId, userId: null, route }, async () => {
    try {
      const token = extractToken(req);
      if (!token) throw unauthorized("No authentication token provided");

      let payload: AccessTokenPayload;
      try {
        payload = await verifyAccessToken(token);
      } catch {
        throw unauthorized("Invalid or expired access token");
      }

      // BUG-19: reject pre-auth tokens on all routes except the 2FA verify endpoint
      if (payload.type === 'pre_auth' && new URL(req.url).pathname !== '/api/auth/2fa/verify') {
        throw unauthorized("Pre-authentication token cannot be used for this endpoint");
      }

      // Update request context with authenticated user
      const store = requestContext.getStore();
      if (store) store.userId = payload.sub;

      // ---------------------------------------------------------------
      // Session / account verification (REDIS-COST-01)
      //
      // This block used to run TWO Redis reads on EVERY authenticated
      // request — `GET session:<sid>` and `GET user:status:<uid>` — plus a
      // `SETEX` whenever the 10-second status cache lapsed. Across the whole
      // app that was our single largest source of Redis traffic, and it
      // scaled linearly with page views rather than with logins.
      //
      // Both reads now happen only where a stale credential could actually
      // cause harm (see `requiresLiveVerification`). Elsewhere we trust the
      // signed access token, which is short-lived and cannot be forged, and
      // rely on push-based revocation: `revokeUserAccess` destroys a user's
      // session records the instant their standing changes, which fails their
      // next token refresh and every sensitive request in between.
      // ---------------------------------------------------------------
      const needsLiveCheck = requiresLiveVerification(req, route);
      let session: SessionRecord | null = null;

      if (needsLiveCheck) {
        // Bypass the L1 cache: on these paths we want the current truth, not a
        // copy that may be up to SESSION_CACHE_TTL_MS old.
        session = await getSessionFresh(payload.sid);
        if (!session) {
          // Clear the stale cookies so the browser doesn't loop between /home
          // and /auth/login with a JWT that passes signature checks but has no
          // corresponding Redis session.
          const cleared = NextResponse.json(
            { error: "Unauthorised", code: "SESSION_REVOKED" },
            { status: 401 }
          );
          cleared.cookies.set(ACCESS_TOKEN_COOKIE, "", { maxAge: 0, path: "/" });
          cleared.cookies.set(REFRESH_TOKEN_COOKIE, "", { maxAge: 0, path: "/" });
          cleared.headers.set("X-Request-Id", requestId);
          return cleared;
        }
        // Fails closed — an unreadable account row rejects the request.
        await assertAccountActive(payload.sub);
      }

      // Geolocation anomaly detection (PRD §19, §23)
      // Compare login IP vs current request IP. After a threshold of drastic
      // IP changes within 1 hour, force session invalidation. The login IP
      // comes from the session record when we already read it, and otherwise
      // from the signed `lip` access-token claim — so this check survives the
      // removal of the per-request session read at no Redis cost.
      const currentIp = getClientIp(req);
      const loginIp = session?.ip ?? payload.lip;
      const geoCheckPassed = await runGeoAnomalyCheck(
        payload.sid,
        payload.sub,
        loginIp,
        currentIp
      );
      if (!geoCheckPassed) {
        await invalidateSession(payload.sid, payload.sub).catch(() => {});
        throw unauthorized(
          "Session invalidated due to suspicious IP activity. Please log in again."
        );
      }

      // BUG-SEC-03: Build a withRLS helper that sets app.current_user_id via SET LOCAL
      // inside a transaction, enabling PostgreSQL RLS policies per request.
      const withRLS = <T>(fn: (client: DbOrTx) => Promise<T>): Promise<T> =>
        getDb().then((orm) =>
          orm.transaction(async (client) => {
            await client.execute(sql`SELECT set_config('app.current_user_id', ${payload.sub}, TRUE)`);
            return fn(client);
          })
        );

      const start = Date.now();
      let result: NextResponse | ApiError;
      try {
        result = await handler(req, {
          params: await ctx.params,
          auth: { user: payload, withRLS },
        });
      } catch (handlerErr) {
        logger.error({ requestId, userId: payload.sub, durationMs: Date.now() - start }, "request handler threw");
        throw handlerErr;
      }
      const durationMs = Date.now() - start;
      if (result instanceof ApiError) {
        const res = handleApiError(result);
        res.headers.set("X-Request-Id", requestId);
        logger.info({ requestId, userId: payload.sub, durationMs, status: res.status }, "request completed");
        return res;
      }
      result.headers.set("X-Request-Id", requestId);
      logger.info({ requestId, userId: payload.sub, durationMs, status: result.status }, "request completed");
      return result;
    } catch (err) {
      const res = handleApiError(err);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }
    }); // end requestContext.run
  };
}

// ---------------------------------------------------------------------------
// withAdminAuth HOC
// ---------------------------------------------------------------------------

/**
 * Higher-order component that validates the JWT AND performs a live database
 * check to confirm is_admin = true.
 *
 * IMPORTANT: The JWT claim alone is NOT trusted for admin checks.
 * The database is the source of truth.
 *
 * @param handler - Admin route handler
 * @returns Next.js compatible route handler
 */
export function withAdminAuth<TParams = Record<string, string>>(
  handler: AdminHandler<TParams>
// See withAuth above: Awaited<TParams> prevents a doubly-wrapped Promise export.
): (req: NextRequest, ctx: { params: Promise<Awaited<TParams>> }) => Promise<NextResponse> {
  return async (req, ctx) => {
    const requestId = randomUUID();
    const route = new URL(req.url).pathname;

    return requestContext.run({ requestId, userId: null, route }, async () => {
    try {
      const token = extractToken(req);
      if (!token) throw unauthorized("No authentication token provided");

      let payload: AccessTokenPayload;
      try {
        payload = await verifyAccessToken(token);
      } catch {
        throw unauthorized("Invalid or expired access token");
      }

      // Update request context with authenticated user
      const store = requestContext.getStore();
      if (store) store.userId = payload.sub;

      // BUG-L1-01: bypass the 3-second L1 in-process cache for admin paths so a
      // de-provisioned admin cannot continue to act within the staleness window.
      const session = await getSessionFresh(payload.sid);
      if (!session) {
        const cleared = NextResponse.json(
          { error: "Unauthorised", code: "SESSION_REVOKED" },
          { status: 401 }
        );
        cleared.cookies.set(ACCESS_TOKEN_COOKIE, "", { maxAge: 0, path: "/" });
        cleared.cookies.set(REFRESH_TOKEN_COOKIE, "", { maxAge: 0, path: "/" });
        cleared.headers.set("X-Request-Id", requestId);
        return cleared;
      }

      // ALWAYS check is_admin from the database – never trust JWT claim alone
      const orm = await getDb();
      const rows = await orm
        .select({
          is_admin: schema.users.isAdmin,
          is_banned: sql<boolean>`COALESCE(${schema.users.isBanned}, false)`,
          is_suspended: sql<boolean>`COALESCE(${schema.users.isSuspended}, false)`,
        })
        .from(schema.users)
        .where(and(eq(schema.users.id, payload.sub), isNull(schema.users.deletedAt)))
        .limit(1);

      if (!rows[0]?.is_admin) {
        throw forbidden("Administrator access required");
      }

      if (rows[0].is_banned || rows[0].is_suspended) {
        throw forbidden("Account is suspended or banned");
      }

      // Geolocation anomaly detection — same protection for admin routes
      const currentIp = getClientIp(req);
      const geoCheckPassed = await runGeoAnomalyCheck(
        session.sid,
        session.uid,
        session.ip,
        currentIp
      );
      if (!geoCheckPassed) {
        await invalidateSession(payload.sid, payload.sub).catch(() => {});
        throw unauthorized(
          "Session invalidated due to suspicious IP activity. Please log in again."
        );
      }

      const withRLSAdmin = <T>(fn: (client: DbOrTx) => Promise<T>): Promise<T> =>
        getDb().then((orm) =>
          orm.transaction(async (client) => {
            await client.execute(sql`SELECT set_config('app.current_user_id', ${payload.sub}, TRUE)`);
            return fn(client);
          })
        );

      const start = Date.now();
      let result: NextResponse | ApiError;
      try {
        result = await handler(req, {
          params: await ctx.params,
          auth: { user: payload, isAdmin: true, withRLS: withRLSAdmin },
        });
      } catch (handlerErr) {
        logger.error({ requestId, userId: payload.sub, durationMs: Date.now() - start }, "request handler threw");
        throw handlerErr;
      }
      const durationMs = Date.now() - start;
      if (result instanceof ApiError) {
        const res = handleApiError(result);
        res.headers.set("X-Request-Id", requestId);
        logger.info({ requestId, userId: payload.sub, durationMs, status: res.status }, "request completed");
        return res;
      }

      const response = result as NextResponse;
      response.headers.set("X-Request-Id", requestId);
      logger.info({ requestId, userId: payload.sub, durationMs, status: response.status }, "request completed");
      return response;
    } catch (err) {
      const res = handleApiError(err);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }
    });
  };
}

// ---------------------------------------------------------------------------
// withModeratorOrAdminAuth HOC
// ---------------------------------------------------------------------------

/**
 * Higher-order component that validates the JWT AND performs a live database
 * check to confirm is_admin OR is_moderator = true.
 *
 * Scoped for /api/admin/forum/** only — every other /api/admin/** route
 * keeps using withAdminAuth (admin-only) unchanged. Mirrors withAdminAuth's
 * "never trust the JWT claim alone" convention: the DATABASE is always the
 * source of truth for authorization, even though the edge middleware
 * pre-filter already checked the (lower-trust) JWT claim.
 *
 * @param handler - Moderator-or-admin route handler
 * @returns Next.js compatible route handler
 */
export function withModeratorOrAdminAuth<TParams = Record<string, string>>(
  handler: ModeratorHandler<TParams>
): (req: NextRequest, ctx: { params: Promise<Awaited<TParams>> }) => Promise<NextResponse> {
  return async (req, ctx) => {
    const requestId = randomUUID();
    const route = new URL(req.url).pathname;

    return requestContext.run({ requestId, userId: null, route }, async () => {
    try {
      const token = extractToken(req);
      if (!token) throw unauthorized("No authentication token provided");

      let payload: AccessTokenPayload;
      try {
        payload = await verifyAccessToken(token);
      } catch {
        throw unauthorized("Invalid or expired access token");
      }

      const store = requestContext.getStore();
      if (store) store.userId = payload.sub;

      // Bypass the L1 in-process cache so a de-provisioned mod/admin cannot
      // continue to act within the staleness window (same as withAdminAuth).
      const session = await getSessionFresh(payload.sid);
      if (!session) {
        const cleared = NextResponse.json(
          { error: "Unauthorised", code: "SESSION_REVOKED" },
          { status: 401 }
        );
        cleared.cookies.set(ACCESS_TOKEN_COOKIE, "", { maxAge: 0, path: "/" });
        cleared.cookies.set(REFRESH_TOKEN_COOKIE, "", { maxAge: 0, path: "/" });
        cleared.headers.set("X-Request-Id", requestId);
        return cleared;
      }

      // ALWAYS check is_admin/is_moderator from the database – never trust JWT claim alone
      const orm = await getDb();
      const rows = await orm
        .select({
          is_admin: schema.users.isAdmin,
          is_moderator: sql<boolean>`COALESCE(${schema.users.isModerator}, false)`,
          is_banned: sql<boolean>`COALESCE(${schema.users.isBanned}, false)`,
          is_suspended: sql<boolean>`COALESCE(${schema.users.isSuspended}, false)`,
        })
        .from(schema.users)
        .where(and(eq(schema.users.id, payload.sub), isNull(schema.users.deletedAt)))
        .limit(1);

      const isAdmin = !!rows[0]?.is_admin;
      const isModerator = !!rows[0]?.is_moderator;
      if (!isAdmin && !isModerator) {
        throw forbidden("Moderator or administrator access required");
      }

      if (rows[0].is_banned || rows[0].is_suspended) {
        throw forbidden("Account is suspended or banned");
      }

      const currentIp = getClientIp(req);
      const geoCheckPassed = await runGeoAnomalyCheck(
        session.sid,
        session.uid,
        session.ip,
        currentIp
      );
      if (!geoCheckPassed) {
        await invalidateSession(payload.sid, payload.sub).catch(() => {});
        throw unauthorized(
          "Session invalidated due to suspicious IP activity. Please log in again."
        );
      }

      const withRLSMod = <T>(fn: (client: DbOrTx) => Promise<T>): Promise<T> =>
        getDb().then((orm) =>
          orm.transaction(async (client) => {
            await client.execute(sql`SELECT set_config('app.current_user_id', ${payload.sub}, TRUE)`);
            return fn(client);
          })
        );

      const start = Date.now();
      let result: NextResponse | ApiError;
      try {
        result = await handler(req, {
          params: await ctx.params,
          auth: { user: payload, isAdmin, isModerator, withRLS: withRLSMod },
        });
      } catch (handlerErr) {
        logger.error({ requestId, userId: payload.sub, durationMs: Date.now() - start }, "request handler threw");
        throw handlerErr;
      }
      const durationMs = Date.now() - start;
      if (result instanceof ApiError) {
        const res = handleApiError(result);
        res.headers.set("X-Request-Id", requestId);
        logger.info({ requestId, userId: payload.sub, durationMs, status: res.status }, "request completed");
        return res;
      }

      const response = result as NextResponse;
      response.headers.set("X-Request-Id", requestId);
      logger.info({ requestId, userId: payload.sub, durationMs, status: response.status }, "request completed");
      return response;
    } catch (err) {
      const res = handleApiError(err);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }
    });
  };
}

// ---------------------------------------------------------------------------
// withAdModeratorOrAdminAuth HOC
// ---------------------------------------------------------------------------

/**
 * Higher-order component that validates the JWT AND performs a live database
 * check to confirm is_admin OR is_ad_moderator = true.
 *
 * Scoped for /api/admin/ads/moderation-queue/** — the Ad Moderator review
 * queue for ad creative images that neither AI provider could confidently
 * classify. Ad Moderator is a narrower staff role than full moderator/admin
 * (see lib/auth/roles.ts StaffRoles.isAdModerator); it does not grant access
 * to any other /api/admin/** route. Mirrors withModeratorOrAdminAuth's
 * "never trust the JWT claim alone" convention.
 *
 * @param handler - Ad-moderator-or-admin route handler
 * @returns Next.js compatible route handler
 */
export function withAdModeratorOrAdminAuth<TParams = Record<string, string>>(
  handler: AdModeratorHandler<TParams>
): (req: NextRequest, ctx: { params: Promise<Awaited<TParams>> }) => Promise<NextResponse> {
  return async (req, ctx) => {
    const requestId = randomUUID();
    const route = new URL(req.url).pathname;

    return requestContext.run({ requestId, userId: null, route }, async () => {
    try {
      const token = extractToken(req);
      if (!token) throw unauthorized("No authentication token provided");

      let payload: AccessTokenPayload;
      try {
        payload = await verifyAccessToken(token);
      } catch {
        throw unauthorized("Invalid or expired access token");
      }

      const store = requestContext.getStore();
      if (store) store.userId = payload.sub;

      const session = await getSessionFresh(payload.sid);
      if (!session) {
        const cleared = NextResponse.json(
          { error: "Unauthorised", code: "SESSION_REVOKED" },
          { status: 401 }
        );
        cleared.cookies.set(ACCESS_TOKEN_COOKIE, "", { maxAge: 0, path: "/" });
        cleared.cookies.set(REFRESH_TOKEN_COOKIE, "", { maxAge: 0, path: "/" });
        cleared.headers.set("X-Request-Id", requestId);
        return cleared;
      }

      // ALWAYS check is_admin/is_ad_moderator from the database – never trust JWT claim alone
      //
      // NOTE (schema gap): `users.is_ad_moderator` (migration 0002) is not modeled
      // in lib/db/schema.ts's `users` table, so it's selected here as a raw `sql`
      // expression rather than a query-builder column, alongside the modeled ones.
      const orm = await getDb();
      const rows = await orm
        .select({
          is_admin: schema.users.isAdmin,
          is_ad_moderator: sql<boolean>`COALESCE(is_ad_moderator, false)`,
          is_banned: sql<boolean>`COALESCE(${schema.users.isBanned}, false)`,
          is_suspended: sql<boolean>`COALESCE(${schema.users.isSuspended}, false)`,
        })
        .from(schema.users)
        .where(and(eq(schema.users.id, payload.sub), isNull(schema.users.deletedAt)))
        .limit(1);

      const isAdmin = !!rows[0]?.is_admin;
      const isAdModerator = !!rows[0]?.is_ad_moderator;
      if (!isAdmin && !isAdModerator) {
        throw forbidden("Ad Moderator or administrator access required");
      }

      if (rows[0].is_banned || rows[0].is_suspended) {
        throw forbidden("Account is suspended or banned");
      }

      const currentIp = getClientIp(req);
      const geoCheckPassed = await runGeoAnomalyCheck(
        session.sid,
        session.uid,
        session.ip,
        currentIp
      );
      if (!geoCheckPassed) {
        await invalidateSession(payload.sid, payload.sub).catch(() => {});
        throw unauthorized(
          "Session invalidated due to suspicious IP activity. Please log in again."
        );
      }

      const withRLSAdMod = <T>(fn: (client: DbOrTx) => Promise<T>): Promise<T> =>
        getDb().then((orm) =>
          orm.transaction(async (client) => {
            await client.execute(sql`SELECT set_config('app.current_user_id', ${payload.sub}, TRUE)`);
            return fn(client);
          })
        );

      const start = Date.now();
      let result: NextResponse | ApiError;
      try {
        result = await handler(req, {
          params: await ctx.params,
          auth: { user: payload, isAdmin, isAdModerator, withRLS: withRLSAdMod },
        });
      } catch (handlerErr) {
        logger.error({ requestId, userId: payload.sub, durationMs: Date.now() - start }, "request handler threw");
        throw handlerErr;
      }
      const durationMs = Date.now() - start;
      if (result instanceof ApiError) {
        const res = handleApiError(result);
        res.headers.set("X-Request-Id", requestId);
        logger.info({ requestId, userId: payload.sub, durationMs, status: res.status }, "request completed");
        return res;
      }

      const response = result as NextResponse;
      response.headers.set("X-Request-Id", requestId);
      logger.info({ requestId, userId: payload.sub, durationMs, status: response.status }, "request completed");
      return response;
    } catch (err) {
      const res = handleApiError(err);
      res.headers.set("X-Request-Id", requestId);
      return res;
    }
    });
  };
}

// ---------------------------------------------------------------------------
// withRateLimit HOC
// ---------------------------------------------------------------------------

/**
 * Higher-order component that applies rate limiting before the handler runs.
 * Limits by user ID if an auth token is present, otherwise by IP.
 *
 * @param handler - Any route handler
 * @param options - Rate limit configuration
 * @returns Next.js compatible route handler
 */
export function withRateLimit<TParams = Record<string, string>>(
  handler: (req: NextRequest, ctx: { params: Promise<TParams> }) => Promise<NextResponse>,
  options: RateLimitOptions
): (req: NextRequest, ctx: { params: Promise<TParams> }) => Promise<NextResponse> {
  return async (req, ctx) => {
    try {
      // Try to extract user identity for per-user limiting
      const token = extractToken(req);
      let subject: string;
      let type: "user" | "ip";

      if (token) {
        try {
          const payload = await verifyAccessToken(token);
          subject = payload.sub;
          type = "user";
        } catch {
          subject = getClientIp(req);
          type = "ip";
        }
      } else {
        subject = getClientIp(req);
        type = "ip";
      }

      await enforceRateLimit(subject, type, options);
      return await handler(req, ctx);
    } catch (err) {
      return handleApiError(err);
    }
  };
}

// ---------------------------------------------------------------------------
// validateBody helper
// ---------------------------------------------------------------------------

/**
 * Parse and validate the request body against a Zod schema.
 * Throws a 400 ApiError with field-level details if validation fails.
 *
 * @param req    - Incoming Next.js request
 * @param schema - Zod schema to validate against
 * @returns Parsed and typed body
 * @throws {ApiError} 400 if body is invalid JSON or fails schema validation
 */
export async function validateBody<T>(
  req: NextRequest,
  schema: ZodType<T, ZodTypeDef, unknown>
): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }

  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw badRequest("Invalid request body", { issues: err.issues });
    }
    throw err;
  }
}

/**
 * Parse and validate URL search params against a Zod schema.
 *
 * @param searchParams - URLSearchParams from the request URL
 * @param schema       - Zod schema to validate against
 * @returns Parsed and typed params
 * @throws {ApiError} 400 if params fail schema validation
 */
export function validateSearchParams<T>(
  searchParams: URLSearchParams,
  schema: ZodType<T, ZodTypeDef, unknown>
): T {
  const params = Object.fromEntries(searchParams.entries());
  try {
    return schema.parse(params);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw badRequest("Invalid query parameters", { issues: err.issues });
    }
    throw err;
  }
}
