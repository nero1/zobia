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

// BUG-072 FIX: centralise the bcrypt cost factor so it is never accidentally
// lowered. 12 rounds is the minimum for PIN storage (4-digit key space is tiny,
// so the hash must be expensive to compute). This constant is checked after
// hashing to ensure the stored hash actually uses the expected cost factor.
const BCRYPT_ROUNDS = 12;

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

    // Hash the PIN with bcrypt (BCRYPT_ROUNDS as required for sensitive PINs)
    // BUG-072 FIX: use the named constant and validate the produced hash starts
    // with the expected bcrypt 2b prefix before storing it in the database.
    const pinHash = await bcrypt.hash(body.pin, BCRYPT_ROUNDS);
    if (!pinHash.startsWith("$2b$")) {
      // This should never happen with bcryptjs, but guard defensively so a
      // misconfigured or monkey-patched bcrypt cannot silently store a weak hash.
      throw new Error("[pin/setup] bcrypt produced an unexpected hash format");
    }

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
