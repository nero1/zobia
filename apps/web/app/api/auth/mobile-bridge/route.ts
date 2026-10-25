import { getSessionFresh } from "@/lib/auth/session";
import { BRIDGE_TTL_SECONDS, isAllowedBridgePath } from "@/lib/auth/mobileBridge";
export const dynamic = 'force-dynamic';

/** Mint a short-lived, path-bound, one-use grant for a live native session.
 * Opening its browser link establishes a confirmation intent; browser cookies
 * are issued only after the user confirms with that browser's bound secret. */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { redis } from "@/lib/redis";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

const MintSchema = z.object({
  path: z.string().min(1).max(512),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    const { path } = await validateBody(req, MintSchema);
    if (!isAllowedBridgePath(path)) {
      throw badRequest("Path is not eligible for an authenticated browser hand-off.", "PATH_NOT_ALLOWED");
    }

    const source = await getSessionFresh(auth.user.sid);
    if (!source || source.uid!==userId || source.parentSid) throw badRequest("This session cannot create another browser hand-off");
    const code = randomBytes(32).toString("hex");
    await redis.setex(`mobile_bridge:${code}`, BRIDGE_TTL_SECONDS, JSON.stringify({userId, sourceSid:auth.user.sid, path}));

    return NextResponse.json({ success: true, data: { code }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
