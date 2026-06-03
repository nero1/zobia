/**
 * app/api/auth/pin/remove/route.ts
 *
 * DELETE /api/auth/pin/remove
 *
 * Remove the authenticated user's PIN. Requires the current PIN to be
 * supplied and verified before deletion to prevent unauthorized removal.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, ApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const removePinSchema = z.object({
  currentPin: z
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
// DELETE /api/auth/pin/remove
// ---------------------------------------------------------------------------

/**
 * Remove the authenticated user's PIN after verifying the current PIN.
 *
 * @returns JSON { success: true }
 */
export const DELETE = withAuth(async (req: NextRequest, { auth }) => {
  try {
    // Tighter rate limit to prevent brute-force
    await enforceRateLimit(auth.user.sub, "user", {
      limit: 10,
      windowMs: 60 * 1000,
      name: "pin:remove",
    });

    const body = await validateBody(req, removePinSchema);

    // Fetch the user's stored PIN hash
    const { rows } = await db.query<UserPinRow>(
      `SELECT pin_hash FROM user_pins WHERE user_id = $1 LIMIT 1`,
      [auth.user.sub]
    );

    if (!rows[0]) {
      throw new ApiError(422, "NO_PIN_CONFIGURED", "No PIN configured for this account");
    }

    // Verify the supplied current PIN before allowing removal
    const isValid = await bcrypt.compare(body.currentPin, rows[0].pin_hash);
    if (!isValid) {
      throw badRequest("Incorrect PIN", "INVALID_PIN");
    }

    // Delete the PIN record
    await db.query(
      `DELETE FROM user_pins WHERE user_id = $1`,
      [auth.user.sub]
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
