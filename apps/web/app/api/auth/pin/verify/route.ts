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
import { redis } from "@/lib/redis";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, ApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { markPinVerified } from "@/lib/auth/pinGuard";

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
    // PIN-specific rate limit: 5 attempts per 15 minutes to prevent brute-force (BUG-14)
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pinVerify);

    const userId = auth.user.sub;
    const body = await validateBody(req, verifyPinSchema);

    // Check lockout
    const failKey = `pin_fail:${userId}`;
    const failures = parseInt(await redis.get(failKey) ?? "0", 10);
    if (failures >= 20) {
      return NextResponse.json(
        { error: "PIN locked: too many failed attempts. Please re-authenticate.", code: "PIN_LOCKED" },
        { status: 429 }
      );
    }
    if (failures >= 10) {
      const ttl = await redis.ttl(failKey);
      if (ttl > 0) {
        return NextResponse.json(
          { error: `PIN temporarily locked. Try again in ${Math.ceil(ttl / 60)} minutes.`, code: "PIN_LOCKED" },
          { status: 429 }
        );
      }
    }

    // Fetch the user's stored PIN hash
    const { rows } = await db.query<UserPinRow>(
      `SELECT pin_hash FROM user_pins WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    if (!rows[0]) {
      // No PIN configured — return 422 Unprocessable Entity
      throw new ApiError(422, "NO_PIN_CONFIGURED", "No PIN configured for this account");
    }

    const verified = await bcrypt.compare(body.pin, rows[0].pin_hash);

    if (!verified) {
      // On wrong PIN, increment failure counter with escalating lockout
      const newFailures = await redis.incr(failKey);
      const lockoutTtl = newFailures >= 20 ? 24 * 3600 : newFailures >= 10 ? 30 * 60 : 5 * 60;
      await redis.expire(failKey, lockoutTtl);
    } else {
      // On success, clear the failure counter and record the verified session
      await redis.del(failKey);
      await markPinVerified(userId);
    }

    return NextResponse.json({ verified }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
