export const dynamic = 'force-dynamic';

/**
 * app/api/auth/pin/verify/route.ts
 *
 * POST /api/auth/pin/verify
 *
 * Verify a user's PIN for sensitive operations (payments, payouts, etc).
 * Returns { verified: true } on success, 400 INVALID_PIN on mismatch and 429
 * PIN_LOCKED after too many failures (lib/auth/pinAttempts.ts).
 * Returns 422 if the user has no PIN configured.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/drizzle";
import { eq } from "drizzle-orm";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, ApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { markPinVerified } from "@/lib/auth/pinGuard";
import { assertPinNotLocked, requireCorrectPin } from "@/lib/auth/pinAttempts";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const verifyPinSchema = z.object({
  pin: z
    .string()
    .regex(/^\d{4}$/, "PIN must be exactly 4 numeric digits"),
});

// ---------------------------------------------------------------------------
// POST /api/auth/pin/verify
// ---------------------------------------------------------------------------

/**
 * Verify the authenticated user's PIN.
 *
 * 200 { verified: true }                     correct PIN
 * 400 INVALID_PIN { attemptsRemaining }      wrong PIN (NOT 401 — see requireCorrectPin)
 * 429 PIN_LOCKED                             locked out after repeated wrong PINs
 * 422 NO_PIN_CONFIGURED                      user has no PIN
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    // Coarse request throttle (bcrypt CPU-DoS guard). Brute-force protection is
    // the failed-attempt lockout in lib/auth/pinAttempts.ts, which — unlike a
    // plain rate limit — is not consumed by successful verifications.
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pinVerifyRequests);

    const userId = auth.user.sub;
    const body = await validateBody(req, verifyPinSchema);

    // Cheap lock check first so a locked account never reaches the database.
    await assertPinNotLocked(userId);

    const orm = await getDb();
    const rows = await orm
      .select({ pinHash: schema.userPins.pinHash })
      .from(schema.userPins)
      .where(eq(schema.userPins.userId, userId))
      .limit(1);

    if (!rows[0]) {
      throw new ApiError(422, "NO_PIN_CONFIGURED", "No PIN configured for this account");
    }

    await requireCorrectPin(userId, body.pin, rows[0].pinHash);
    await markPinVerified(userId, auth.user.sid);

    return NextResponse.json({ verified: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
