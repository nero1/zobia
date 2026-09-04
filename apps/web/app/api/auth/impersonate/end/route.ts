export const dynamic = 'force-dynamic';

/**
 * app/api/auth/impersonate/end/route.ts
 *
 * POST /api/auth/impersonate/end
 *
 * Ends the current impersonation session and restores the admin's own
 * session from the backup cookie pair set by
 * app/api/admin/users/[userId]/impersonate/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import {
  invalidateSession,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  ADMIN_BACKUP_ACCESS_COOKIE,
  ADMIN_BACKUP_REFRESH_COOKIE,
} from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    if (!auth.user.impersonated_by) {
      throw badRequest("No impersonation session is active.");
    }

    const backupAccessToken = req.cookies.get(ADMIN_BACKUP_ACCESS_COOKIE)?.value;
    const backupRefreshToken = req.cookies.get(ADMIN_BACKUP_REFRESH_COOKIE)?.value;
    if (!backupAccessToken || !backupRefreshToken) {
      throw badRequest("Original admin session could not be restored — please sign in again.");
    }

    await invalidateSession(auth.user.sid, auth.user.sub);

    db.query(
      `INSERT INTO admin_audit_log (admin_id, action, resource, resource_id, before_val, after_val, created_at)
       VALUES ($1, 'impersonate_end', 'users', $2, NULL, NULL, NOW())`,
      [auth.user.impersonated_by, auth.user.sub]
    ).catch((err) => logger.error({ err }, "[admin:impersonate] Failed to write admin_audit_log entry (non-fatal)"));

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
