export const dynamic = 'force-dynamic';

/**
 * app/api/auth/impersonate/end/route.ts
 *
 * POST /api/auth/impersonate/end
 *
 * Ends the current impersonation session and restores the admin's own
 * session.
 *
 * - Web / cookie clients: restores from the backup cookie pair set by
 *   app/api/admin/users/[userId]/impersonate/route.ts. Unchanged from before.
 * - Bearer / mobile clients (detected the same `Authorization: Bearer`
 *   convention used everywhere else — see extractToken in
 *   lib/api/middleware.ts): there is no backup cookie pair to read, so the
 *   admin id is instead taken from the impersonation token's own tamper-proof
 *   `impersonated_by` claim (auth.user.impersonated_by — already verified by
 *   withAuth's JWT signature check). A fresh access/refresh token pair for
 *   that admin is minted the same way a normal login does (createSession)
 *   and returned in the JSON body, same shape as a normal login response.
 *   The admin's original pre-impersonation session is left to expire on its
 *   own short admin TTL rather than reused, so this can never corrupt that
 *   session's refresh-token rotation chain (see BUG-24 in
 *   lib/auth/session.ts) or trip its reuse-detection and revoke every admin
 *   session by accident.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { extractBearerToken } from "@/lib/auth/jwt";
import {
  createSession,
  invalidateSession,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  ADMIN_BACKUP_ACCESS_COOKIE,
  ADMIN_BACKUP_REFRESH_COOKIE,
} from "@/lib/auth/session";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { getClientIp } from "@/lib/security/rateLimit";
import { logger } from "@/lib/logger";

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    if (!auth.user.impersonated_by) {
      throw badRequest("No impersonation session is active.");
    }

    const isBearerClient = !!extractBearerToken(req.headers.get("authorization"));

    if (isBearerClient) {
      // Fail fast, before mutating anything, if the admin account can no
      // longer be restored to (deleted, or de-admin'd since the
      // impersonation started) — mirrors the cookie-mode guard below, which
      // also checks restorability before invalidating the impersonation
      // session.
      const orm = await getDb();
      const [admin] = await orm
        .select({
          id: schema.users.id,
          email: schema.users.email,
          username: schema.users.username,
          isAdmin: schema.users.isAdmin,
          isModerator: schema.users.isModerator,
          isCreator: schema.users.isCreator,
          onboardingCompleted: schema.users.onboardingCompleted,
          plan: schema.users.plan,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(schema.users)
        .where(and(eq(schema.users.id, auth.user.impersonated_by), isNull(schema.users.deletedAt)))
        .limit(1);
      if (!admin || !admin.isAdmin) {
        throw badRequest("Original admin session could not be restored — please sign in again.");
      }

      await invalidateSession(auth.user.sid, auth.user.sub);

      orm
        .insert(schema.adminAuditLog)
        .values({
          adminId: auth.user.impersonated_by,
          action: "impersonate_end",
          resource: "users",
          resourceId: auth.user.sub,
          beforeVal: null,
          afterVal: null,
        })
        .catch((err) => logger.error({ err }, "[admin:impersonate] Failed to write admin_audit_log entry (non-fatal)"));

      const ip = getClientIp(req);
      const ua = req.headers.get("user-agent") ?? undefined;
      const restored = await createSession(
        {
          id: admin.id,
          email: admin.email,
          username: admin.username,
          is_admin: admin.isAdmin,
          is_moderator: admin.isModerator,
          is_creator: admin.isCreator,
          onboarding_completed: admin.onboardingCompleted ?? undefined,
        },
        { ip, ua }
      );

      return NextResponse.json({
        success: true,
        data: {
          accessToken: restored.accessToken,
          refreshToken: restored.refreshToken,
          expiresIn: restored.expiresIn,
          user: {
            id: admin.id,
            email: admin.email,
            username: admin.username,
            plan: (admin.plan ?? "free") as "free" | "plus" | "pro" | "max",
            is_admin: admin.isAdmin,
            is_moderator: admin.isModerator,
            is_creator: admin.isCreator,
            avatar_url: admin.avatarUrl ?? null,
          },
        },
        error: null,
      });
    }

    const backupAccessToken = req.cookies.get(ADMIN_BACKUP_ACCESS_COOKIE)?.value;
    const backupRefreshToken = req.cookies.get(ADMIN_BACKUP_REFRESH_COOKIE)?.value;
    if (!backupAccessToken || !backupRefreshToken) {
      throw badRequest("Original admin session could not be restored — please sign in again.");
    }

    await invalidateSession(auth.user.sid, auth.user.sub);

    const orm = await getDb();
    orm
      .insert(schema.adminAuditLog)
      .values({
        adminId: auth.user.impersonated_by,
        action: "impersonate_end",
        resource: "users",
        resourceId: auth.user.sub,
        beforeVal: null,
        afterVal: null,
      })
      .catch((err) => logger.error({ err }, "[admin:impersonate] Failed to write admin_audit_log entry (non-fatal)"));

    const secure = process.env.NODE_ENV === "production";
    const flags = `HttpOnly; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;

    const response = NextResponse.json({ success: true, error: null });
    response.headers.append("Set-Cookie", `${ACCESS_TOKEN_COOKIE}=${backupAccessToken}; ${flags}`);
    response.headers.append("Set-Cookie", `${REFRESH_TOKEN_COOKIE}=${backupRefreshToken}; ${flags}`);
    response.headers.append("Set-Cookie", `${ADMIN_BACKUP_ACCESS_COOKIE}=; Max-Age=0; ${flags}`);
    response.headers.append("Set-Cookie", `${ADMIN_BACKUP_REFRESH_COOKIE}=; Max-Age=0; ${flags}`);
    response.headers.append("Set-Cookie", `zobia_impersonating=; Max-Age=0; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`);
    return response;
  } catch (err) {
    return handleApiError(err);
  }
});
