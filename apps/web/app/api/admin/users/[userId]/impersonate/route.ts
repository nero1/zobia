export const dynamic = 'force-dynamic';

/**
 * app/api/admin/users/[userId]/impersonate/route.ts
 *
 * POST /api/admin/users/:userId/impersonate
 *
 * Starts an impersonation session.
 *
 * - Web / cookie clients: the admin's browser gets the target user's
 *   session cookies (so requests go through as that user), while the
 *   admin's own tokens are stashed in a separate short-lived cookie pair so
 *   POST /api/auth/impersonate/end can restore them. Unchanged from before.
 * - Bearer / mobile clients (detected the same way withAdminAuth/withAuth
 *   already distinguish auth modes — an `Authorization: Bearer` header):
 *   cookies can't be read or set by a Capacitor Bearer-JWT client, so the
 *   target's freshly-minted access/refresh token pair is returned directly
 *   in the JSON body instead (same shape as a normal login response), plus
 *   the admin's own id so the client can render the impersonation banner
 *   and know who to restore. No separate server-side "backup" state is
 *   needed for this mode: the admin id is already carried, tamper-proof,
 *   in the target token's `impersonated_by` claim (see lib/auth/jwt.ts and
 *   createSession in lib/auth/session.ts) and in the Redis session record
 *   itself — /api/auth/impersonate/end's Bearer branch reads it from there.
 *
 * Shared regardless of auth mode:
 * - Cannot impersonate another admin (privilege-escalation guard).
 * - The impersonation session is capped to 15 minutes regardless of the
 *   target's normal session TTL (see createSession in lib/auth/session.ts).
 * - Logged to admin_audit_log for traceability.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { extractBearerToken } from "@/lib/auth/jwt";
import {
  createSession,
  buildCookieHeaders,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  ADMIN_BACKUP_ACCESS_COOKIE,
  ADMIN_BACKUP_REFRESH_COOKIE,
} from "@/lib/auth/session";
import { logger } from "@/lib/logger";

interface TargetUserRow {
  id: string;
  email: string | null;
  username: string;
  is_admin: boolean;
  is_moderator: boolean;
  is_creator: boolean;
  onboarding_completed: boolean;
  deleted_at: string | null;
  plan: string | null;
  avatar_url: string | null;
}

const IMPERSONATION_MAX_AGE_SECONDS = 900; // 15 min — matches createSession's impersonation TTL

export const POST = withAdminAuth<{ userId: string }>(
  async (req: NextRequest, { params, auth }) => {
    try {
      const { userId } = params;
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

      // Same convention withAdminAuth/withAuth already use to tell a Capacitor
      // Bearer-JWT client apart from a cookie-session web/PWA client (see
      // extractToken in lib/api/middleware.ts): presence of a Bearer token on
      // THIS request means the admin authenticated with Bearer, and therefore
      // has no cookies to stash/restore.
      const isBearerClient = !!extractBearerToken(req.headers.get("authorization"));

      let adminAccessToken: string | undefined;
      let adminRefreshToken: string | undefined;
      if (!isBearerClient) {
        adminAccessToken = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
        adminRefreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
        if (!adminAccessToken || !adminRefreshToken) {
          throw forbidden("Admin session cookies are required to start impersonation.");
        }
      }

      const orm = await getDb();
      const rows = await orm
        .select({
          id: schema.users.id,
          email: schema.users.email,
          username: schema.users.username,
          is_admin: schema.users.isAdmin,
          is_moderator: schema.users.isModerator,
          is_creator: schema.users.isCreator,
          onboarding_completed: schema.users.onboardingCompleted,
          deleted_at: schema.users.deletedAt,
          plan: schema.users.plan,
          avatar_url: schema.users.avatarUrl,
        })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      const target = rows[0];
      if (!target || target.deleted_at) throw notFound("User not found");
      if (target.is_admin) throw forbidden("Cannot impersonate another admin account.");

      const ip = getClientIp(req);
      const ua = req.headers.get("user-agent") ?? undefined;

      const tokens = await createSession(
        {
          id: target.id,
          email: target.email,
          username: target.username,
          is_admin: false,
          is_moderator: target.is_moderator,
          is_creator: target.is_creator,
          onboarding_completed: target.onboarding_completed ?? false,
        },
        { ip, ua, impersonatedBy: auth.user.sub }
      );

      orm
        .insert(schema.adminAuditLog)
        .values({
          adminId: auth.user.sub,
          action: "impersonate_start",
          resource: "users",
          resourceId: target.id,
          beforeVal: null,
          afterVal: null,
        })
        .catch((err) => logger.error({ err }, "[admin:impersonate] Failed to write admin_audit_log entry (non-fatal)"));

      if (isBearerClient) {
        return NextResponse.json({
          success: true,
          data: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn,
            impersonatedBy: auth.user.sub,
            user: {
              id: target.id,
              email: target.email,
              username: target.username,
              plan: (target.plan ?? "free") as "free" | "plus" | "pro" | "max",
              is_admin: false,
              is_moderator: target.is_moderator,
              is_creator: target.is_creator,
              avatar_url: target.avatar_url ?? null,
            },
          },
          error: null,
        });
      }

      const { accessCookie, refreshCookie } = buildCookieHeaders(tokens, undefined, tokens.refreshTtl);
      const secure = process.env.NODE_ENV === "production";
      const backupFlags = `HttpOnly; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;

      const response = NextResponse.json({ success: true, data: { username: target.username }, error: null });
      response.headers.append("Set-Cookie", accessCookie);
      response.headers.append("Set-Cookie", refreshCookie);
      response.headers.append(
        "Set-Cookie",
        `${ADMIN_BACKUP_ACCESS_COOKIE}=${adminAccessToken}; Max-Age=${IMPERSONATION_MAX_AGE_SECONDS}; ${backupFlags}`
      );
      response.headers.append(
        "Set-Cookie",
        `${ADMIN_BACKUP_REFRESH_COOKIE}=${adminRefreshToken}; Max-Age=${IMPERSONATION_MAX_AGE_SECONDS}; ${backupFlags}`
      );
      // Non-HttpOnly marker cookie so the client-side ImpersonationBanner can
      // detect impersonation by reading document.cookie — avoids adding a
      // GET /api/auth/me round-trip (and its Redis session read) to every
      // page load for every user just to check this rare case.
      response.headers.append(
        "Set-Cookie",
        `zobia_impersonating=1; Max-Age=${IMPERSONATION_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`
      );
      return response;
    } catch (err) {
      return handleApiError(err);
    }
  }
);
