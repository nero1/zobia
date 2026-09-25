export const dynamic = 'force-dynamic';

/**
 * app/api/users/phone/verify/route.ts
 *
 * POST /api/users/phone/verify
 *
 * Confirm the 6-digit SMS code sent by POST /api/users/phone/start (only
 * reachable when x_manifest `phone_verification_required` is on — otherwise
 * /start saves the number immediately and there is nothing to confirm).
 *
 * Auth required.
 * Body: { code: string }
 * Returns: { phoneNumber: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { confirmPhoneVerification } from "@/lib/phone/verification";

const verifyPhoneSchema = z.object({
  code: z.string().min(1).max(12),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.phoneVerifyCheck);

    const { code } = await validateBody(req, verifyPhoneSchema);
    const result = await confirmPhoneVerification(userId, code);

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
});
