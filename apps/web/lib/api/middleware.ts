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
import { z, ZodSchema, ZodType, ZodTypeDef } from "zod";
import {
  verifyAccessToken,
  extractBearerToken,
  type AccessTokenPayload,
} from "@/lib/auth/jwt";
import { getSession } from "@/lib/auth/session";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { db } from "@/lib/db";
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
import { invalidateSession } from "@/lib/auth/session";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Context object injected into authenticated handlers. */
export interface AuthContext {
  /** Decoded and validated access token payload. */
  user: AccessTokenPayload;
}

/** Context object injected into admin handlers. */
export interface AdminContext extends AuthContext {
  /** Confirmed is_admin=true from the database. */
  isAdmin: true;
}

/**
 * Authenticated route handler type.
 * Receives the standard Next.js args plus an injected AuthContext.
 */
export type AuthHandler<TParams = Record<string, string>> = (
  req: NextRequest,
  ctx: { params: TParams; auth: AuthContext }
) => Promise<NextResponse>;

/**
 * Admin route handler type.
 */
export type AdminHandler<TParams = Record<string, string>> = (
  req: NextRequest,
  ctx: { params: TParams; auth: AdminContext }
) => Promise<NextResponse>;

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
  handler: (req: NextRequest, ctx: { params: any; auth: any }) => Promise<NextResponse | ApiError> // eslint-disable-line
): (req: NextRequest, ctx: { params: Promise<TParams> }) => Promise<NextResponse> {
  return async (req, ctx) => {
    try {
      const token = extractToken(req);
      if (!token) throw unauthorized("No authentication token provided");

      let payload: AccessTokenPayload;
      try {
        payload = await verifyAccessToken(token);
      } catch {
        throw unauthorized("Invalid or expired access token");
      }

      // Confirm session is still alive in Redis (not revoked)
      const session = await getSession(payload.sid);
      if (!session) {
        throw unauthorized("Session has been revoked");
      }

      // Geolocation anomaly detection (PRD §19, §23)
      // Compare login IP vs current request IP. After threshold of drastic
      // IP changes within 1 hour, force session invalidation.
      const currentIp = getClientIp(req);
      if (session.ip && isIpAnomalous(session.ip, currentIp)) {
        const shouldInvalidate = await recordAndCheckAnomaly(
          payload.sid,
          payload.sub,
          session.ip,
          currentIp
        );
        if (shouldInvalidate) {
          await invalidateSession(payload.sid, payload.sub).catch(() => {});
          throw unauthorized(
            "Session invalidated due to suspicious IP activity. Please log in again."
          );
        }
      }

      const result = await handler(req, {
        params: await ctx.params,
        auth: { user: payload },
      });
      if (result instanceof ApiError) return handleApiError(result);
      return result;
    } catch (err) {
      return handleApiError(err);
    }
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
  handler: (req: NextRequest, ctx: { params: any; auth: any }) => Promise<NextResponse | ApiError> // eslint-disable-line
): (req: NextRequest, ctx: { params: Promise<TParams> }) => Promise<NextResponse> {
  return async (req, ctx) => {
    try {
      const token = extractToken(req);
      if (!token) throw unauthorized("No authentication token provided");

      let payload: AccessTokenPayload;
      try {
        payload = await verifyAccessToken(token);
      } catch {
        throw unauthorized("Invalid or expired access token");
      }

      // Confirm session is still alive in Redis
      const session = await getSession(payload.sid);
      if (!session) throw unauthorized("Session has been revoked");

      // ALWAYS check is_admin from the database – never trust JWT claim alone
      const { rows } = await db.query<{ is_admin: boolean }>(
        "SELECT is_admin FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1",
        [payload.sub]
      );

      if (!rows[0]?.is_admin) {
        throw forbidden("Administrator access required");
      }

      const result = await handler(req, {
        params: await ctx.params,
        auth: { user: payload, isAdmin: true },
      });
      if (result instanceof ApiError) return handleApiError(result);
      return result;
    } catch (err) {
      return handleApiError(err);
    }
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
  handler: (req: NextRequest, ctx: { params: any }) => Promise<NextResponse>,
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

  return schema.parse(raw);
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
  return schema.parse(params);
}
