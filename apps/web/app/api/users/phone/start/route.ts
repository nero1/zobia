export const dynamic = 'force-dynamic';

/**
 * app/api/users/phone/start/route.ts
 *
 * POST /api/users/phone/start
 *
 * Begin capturing a phone number for the Settings "Phone Number" field.
 * When x_manifest `phone_verification_required` is off (default), the
 * number is normalised and saved immediately — no SMS involved. When on,
 * a 6-digit code is texted to the number and must be confirmed via
 * POST /api/users/phone/verify before it's saved.
 *
 * Auth required.
 * Body: { phoneNumber: string }
 * Returns: { requiresVerification: boolean, expiresInSeconds?: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { startPhoneVerification } from "@/lib/phone/verification";

const startPhoneSchema = z.object({
  phoneNumber: z.string().min(1).max(32),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.phoneVerifySend);

    const { phoneNumber } = await validateBody(req, startPhoneSchema);
    const result = await startPhoneVerification(userId, phoneNumber);

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
});
