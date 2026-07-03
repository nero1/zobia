export const dynamic = "force-dynamic";

/**
 * app/api/auth/sessions/route.ts
 *
 * BUG-CAP-06 fix — lets a signed-in user see every device/browser currently
 * signed into their account (OWASP session-management: "view active
 * sessions"), so a lost/stolen device can be signed out remotely without
 * involving support. Reads the same `user_sessions:{uid}` Redis sorted set
 * that session creation/eviction already maintains — see
 * lib/auth/session.ts's `createSession` (MAX_SESSIONS eviction) — so this
 * endpoint needed no new tracking mechanism, only a read path.
 *
 * GET /api/auth/sessions — list the caller's active sessions.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { listUserSessions } from "@/lib/auth/session";

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.sessionManage);

    const sessions = await listUserSessions(auth.user.sub);
    const data = sessions.map((s) => ({
      sid: s.sid,
      createdAt: s.createdAt,
      ip: s.ip,
      ua: s.ua,
      isAdmin: s.isAdmin,
      isCurrent: s.sid === auth.user.sid,
    }));

    return NextResponse.json({ success: true, data: { sessions: data }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
