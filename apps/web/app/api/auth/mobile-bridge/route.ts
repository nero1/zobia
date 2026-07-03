export const dynamic = 'force-dynamic';

/**
 * app/api/auth/mobile-bridge/route.ts
 *
 * ZSB-04 fix: the Android app's OAuth flow intentionally never sets browser
 * cookies (it uses Bearer tokens instead), so every "open in browser" hand-off
 * to an authenticated web page (KYC, creator bank account, creator wallet,
 * admin KYC review, resume/play a game) landed on the web login page instead
 * of the intended feature — the Chrome Custom Tab has no session with
 * zobia.org at all.
 *
 * POST /api/auth/mobile-bridge
 *   - Authenticated via the normal Bearer-token `withAuth` middleware.
 *   - Body: { path: string } — the in-app-relative path the app wants to open
 *     in the browser (e.g. "/kyc", "/creator/wallet").
 *   - Mints a short-lived (90s), single-use, random code mapped to the
 *     caller's user id in Redis — same TTL/one-shot pattern already used for
 *     the OAuth `mobile_exchange:*` and `mobile_pre_auth:*` codes in
 *     app/api/auth/google/callback/route.ts.
 *   - Returns: { code: string }
 *
 * The Android app then opens
 * `${WEB_BASE_URL}/api/auth/mobile-bridge/consume?code=<code>&redirect=<path>`
 * in a Custom Tab (see lib/deeplinks/bridge.ts); the consume route (this
 * directory's `consume/route.ts`) exchanges the code for a real, HttpOnly
 * cookie-backed web session before redirecting to `path`.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { redis } from "@/lib/redis";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

const BRIDGE_TTL_SECONDS = 90;

// Only these exact in-app paths (or their dynamic-segment shape) may be
// bridged — mirrors the allowlist-not-arbitrary-redirect pattern already
// used for push notification actions (isAllowedRoute in
// apps/android/src/lib/push/index.ts) and for the OAuth web-redirect param
// in app/api/auth/google/callback/route.ts's SAFE_REDIRECT_RE.
const ALLOWED_BRIDGE_PATHS: RegExp[] = [
  /^\/kyc$/,
  /^\/creator\/bank-account$/,
  /^\/creator\/wallet$/,
  /^\/admin\/kyc(\?.*)?$/,
  /^\/g\/[a-zA-Z0-9_-]+\/play$/,
];

function isAllowedBridgePath(path: string): boolean {
  return ALLOWED_BRIDGE_PATHS.some((re) => re.test(path));
}

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

    const code = randomBytes(32).toString("hex");
    await redis.setex(`mobile_bridge:${code}`, BRIDGE_TTL_SECONDS, userId);

    return NextResponse.json({ success: true, data: { code }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
