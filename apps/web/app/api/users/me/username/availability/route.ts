export const dynamic = 'force-dynamic';

/**
 * app/api/users/me/username/availability/route.ts
 *
 * GET /api/users/me/username/availability?username=foo
 *
 * Live availability check used by the Username Change picker (debounced on
 * the client) BEFORE the user is allowed to proceed to payment/confirmation.
 * Delegates to the single shared checkUsernameAvailability() helper — the
 * same one the change-confirm transaction and registration flow use — so a
 * reserved/held username can never be shown as available here only to fail
 * later, or vice versa.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { checkUsernameAvailability } from "@/lib/username/availability";

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const raw = req.nextUrl.searchParams.get("username");
    if (!raw) throw badRequest("username query parameter is required");

    const availability = await checkUsernameAvailability(raw, { excludeUserId: auth.user.sub });
    return NextResponse.json({ success: true, data: availability, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
