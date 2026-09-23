export const dynamic = "force-dynamic";

/**
 * app/api/appeals/token/route.ts
 *
 * GET /api/appeals/token?code=... — resolve a short-lived appeal token
 * (issued at the moment of a blocked login, see lib/auth/appealToken.ts)
 * WITHOUT consuming it, so the appeal form can prefill the account email,
 * appeal type, original reason, and suspension end date before the user
 * submits. Public — the code itself is the credential.
 */

import { NextRequest, NextResponse } from "next/server";
import { peekAppealToken } from "@/lib/auth/appealToken";
import { enforceRateLimit, getClientIp } from "@/lib/security/rateLimit";
import { handleApiError } from "@/lib/api/errors";

export const GET = async (req: NextRequest) => {
  try {
    const ip = getClientIp(req) ?? "unknown";
    await enforceRateLimit(`appeals:token:${ip}`, "ip", {
      name: "appeals:token",
      windowMs: 60 * 1000,
      limit: 20,
    });

    const code = req.nextUrl.searchParams.get("code") ?? "";
    const payload = await peekAppealToken(code);

    if (!payload) {
      return NextResponse.json({ success: true, data: { valid: false }, error: null });
    }

    return NextResponse.json({
      success: true,
      data: {
        valid: true,
        email: payload.email,
        appealType: payload.appealType,
        reason: payload.reason,
        suspendedUntil: payload.suspendedUntil,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
};
