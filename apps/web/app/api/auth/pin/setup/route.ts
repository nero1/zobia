export const dynamic = 'force-dynamic';

/**
 * app/api/auth/pin/setup/route.ts
 *
 * POST /api/auth/pin/setup
 *
 * Allows an authenticated user to set or change their 4-digit security PIN.
 * The PIN is hashed with bcrypt (12 rounds) before storage.
 * Uses an upsert so this doubles as both "set PIN" and "change PIN".
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getManifestValue } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const setupPinSchema = z.object({
  pin: z
    .string()
    .regex(/^\d{4}$/, "PIN must be exactly 4 numeric digits"),
  confirmPin: z
    .string()
    .regex(/^\d{4}$/, "Confirm PIN must be exactly 4 numeric digits"),
});

// ---------------------------------------------------------------------------
// POST /api/auth/pin/setup
// ---------------------------------------------------------------------------

/**
 * Set or change the authenticated user's 4-digit PIN.
 *
 * @returns JSON { success: true }
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const pinKey = await getManifestValue("feature_pin_auth");
    if (pinKey === "false") {
      return NextResponse.json(
        { error: "PIN authentication is not enabled on this platform", code: "FEATURE_DISABLED" },
        { status: 403 }
      );
    }

    const body = await validateBody(req, setupPinSchema);

    if (body.pin !== body.confirmPin) {
      throw badRequest("PIN and confirmation do not match", "PIN_MISMATCH");
    }

    // Hash the PIN with bcrypt (12 rounds as required for sensitive PINs)
    const pinHash = await bcrypt.hash(body.pin, 12);

    // Upsert: insert new PIN or update existing one
    await db.query(
      `INSERT INTO user_pins (user_id, pin_hash, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET pin_hash = $2, updated_at = NOW()`,
      [auth.user.sub, pinHash]
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
