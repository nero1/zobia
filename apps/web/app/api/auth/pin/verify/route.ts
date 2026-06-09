export const dynamic = 'force-dynamic';

/**
 * app/api/auth/pin/verify/route.ts
 *
 * POST /api/auth/pin/verify
 *
 * Verify a user's PIN for sensitive operations (payments, payouts, etc).
 * Returns { verified: true } on success and { verified: false } on mismatch.
 * Returns 422 if the user has no PIN configured.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, ApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const verifyPinSchema = z.object({
  pin: z
    .string()
    .regex(/^\d{4}$/, "PIN must be exactly 4 numeric digits"),
});

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface UserPinRow {
  pin_hash: string;
}

// ---------------------------------------------------------------------------
// POST /api/auth/pin/verify
// ---------------------------------------------------------------------------

/**
 * Verify the authenticated user's PIN.
 *
 * @returns JSON { verified: true | false }
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    // Tighter rate limit to prevent brute-force: 10 attempts per minute
    await enforceRateLimit(auth.user.sub, "user", {
      limit: 10,
      windowMs: 60 * 1000,
      name: "pin:verify",
    });

    const body = await validateBody(req, verifyPinSchema);

    // Fetch the user's stored PIN hash
    const { rows } = await db.query<UserPinRow>(
      `SELECT pin_hash FROM user_pins WHERE user_id = $1 LIMIT 1`,
      [auth.user.sub]
    );

    if (!rows[0]) {
      // No PIN configured — return 422 Unprocessable Entity
      throw new ApiError(422, "NO_PIN_CONFIGURED", "No PIN configured for this account");
    }

    const verified = await bcrypt.compare(body.pin, rows[0].pin_hash);

    return NextResponse.json({ verified }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
