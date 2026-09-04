export const dynamic = 'force-dynamic';

/**
 * app/api/admin/users/[userId]/impersonate/route.ts
 *
 * POST /api/admin/users/:userId/impersonate
 *
 * Starts an impersonation session: the admin's browser gets the target
 * user's session (so requests go through as that user), while the admin's
 * own tokens are stashed in a separate short-lived cookie pair so
 * POST /api/auth/impersonate/end can restore them.
 *
 * - Cannot impersonate another admin (privilege-escalation guard).
 * - The impersonation session is capped to 15 minutes regardless of the
 *   target's normal session TTL (see createSession in lib/auth/session.ts).
 * - Logged to admin_audit_log for traceability.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
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
}

const IMPERSONATION_MAX_AGE_SECONDS = 900; // 15 min — matches createSession's impersonation TTL

export const POST = withAdminAuth<{ userId: string }>(
  async (req: NextRequest, { params, auth }) => {
    try {
      const { userId } = params;
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

      const adminAccessToken = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
      const adminRefreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
      if (!adminAccessToken || !adminRefreshToken) {
        throw forbidden("Admin session cookies are required to start impersonation.");
      }

      const { rows } = await db.query<TargetUserRow>(
        `SELECT id, email, username, is_admin, is_moderator, is_creator,
                onboarding_completed, deleted_at
         FROM users WHERE id = $1 LIMIT 1`,
        [userId]
      );
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
          onboarding_completed: target.onboarding_completed,
        },
        { ip, ua, impersonatedBy: auth.user.sub }
      );

      db.query(
        `INSERT INTO admin_audit_log (admin_id, action, resource, resource_id, before_val, after_val, created_at)
         VALUES ($1, 'impersonate_start', 'users', $2, NULL, NULL, NOW())`,
        [auth.user.sub, target.id]
      ).catch((err) => logger.error({ err }, "[admin:impersonate] Failed to write admin_audit_log entry (non-fatal)"));

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
