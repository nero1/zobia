export const dynamic = 'force-dynamic';

/**
 * app/api/users/phone/route.ts
 *
 * DELETE /api/users/phone
 *
 * Remove the caller's phone number (and any pending OTP code). Always
 * allowed regardless of the phone_verification_required toggle — a user
 * can opt out of contacts cross-reference matching at any time.
 *
 * Auth required.
 * Returns: { success: true }
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { clearPhoneNumber } from "@/lib/phone/verification";

export const DELETE = withAuth(async (_req, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    await clearPhoneNumber(userId);

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
});
