export const dynamic = 'force-dynamic';

/**
 * app/api/onboarding/check-username/route.ts
 *
 * Username availability check endpoint.
 *
 * GET /api/onboarding/check-username?username=foo
 *   - Delegates to lib/username/availability.ts's checkUsernameAvailability()
 *     — the SAME helper used by the Username Change feature — so a username
 *     held by an active username_reservations hold (redirect or the 1-year
 *     "no longer exists" window) can never be registered here either.
 *   - Returns { available: boolean, reason?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { checkUsernameAvailability } from "@/lib/username/availability";

// ---------------------------------------------------------------------------
// GET /api/onboarding/check-username
// ---------------------------------------------------------------------------

/**
 * Check if a username is available for registration.
 *
 * @returns JSON { available: boolean, reason?: string }
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.onboarding);

    const { searchParams } = new URL(req.url);
    const rawUsername = searchParams.get("username");

    if (!rawUsername) {
      throw badRequest("username query parameter is required");
    }

    const availability = await checkUsernameAvailability(rawUsername);
    return NextResponse.json(availability, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
}
