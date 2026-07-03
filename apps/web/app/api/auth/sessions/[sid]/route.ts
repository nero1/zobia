export const dynamic = "force-dynamic";

/**
 * app/api/auth/sessions/[sid]/route.ts
 *
 * BUG-CAP-06 fix — companion to GET /api/auth/sessions: lets a user revoke
 * one specific session/device (e.g. after losing a phone) without logging
 * out everywhere. Reuses the same `invalidateSession` helper that
 * POST /api/auth/logout and the 2FA-disable flow already call — no new
 * revocation logic, just a new, ownership-checked entry point to it.
 *
 * DELETE /api/auth/sessions/:sid — revoke one of the caller's own sessions.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { invalidateSession, isUsersSession } from "@/lib/auth/session";

export const DELETE = withAuth(
  async (_req: NextRequest, { params, auth }: { params: { sid: string }; auth: { user: { sub: string; sid: string } } }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.sessionManage);

      const { sid } = params;

      // Never allow revoking someone else's session by guessing/leaking a
      // sid — invalidateSession() itself deletes unconditionally by key, so
      // ownership must be confirmed first.
      const owns = await isUsersSession(auth.user.sub, sid);
      if (!owns) throw notFound("Session not found");

      if (sid === auth.user.sid) {
        // Revoking the session making this very request would immediately
        // invalidate the access token mid-request. Point the user at the
        // existing logout endpoint instead, which already handles this
        // (clearing cookies) correctly.
        throw forbidden(
          "Cannot revoke the session you're currently using — use logout instead.",
          "CANNOT_REVOKE_CURRENT_SESSION"
        );
      }

      await invalidateSession(sid, auth.user.sub);

      return NextResponse.json({ success: true, data: { revoked: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
