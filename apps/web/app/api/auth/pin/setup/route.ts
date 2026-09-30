export const dynamic = 'force-dynamic';

/**
 * app/api/auth/pin/setup/route.ts
 *
 * POST /api/auth/pin/setup
 *
 * Allows an authenticated user to set or change their 4-digit security PIN.
 * The PIN is hashed with bcrypt (12 rounds) before storage.
 * Uses an upsert so this doubles as both "set PIN" and "change PIN".
 *
 * CHANGING an existing PIN requires the current PIN (`currentPin`), verified
 * through the shared lockout (lib/auth/pinAttempts.ts). Previously any live
 * session could silently overwrite the PIN. A user who has forgotten their
 * PIN uses POST /api/auth/pin/reset instead.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getManifestValue } from "@/lib/manifest";
import { eq } from "drizzle-orm";
import { assertPinNotLocked, requireCorrectPin } from "@/lib/auth/pinAttempts";

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
  /** Required when a PIN already exists (change flow). */
  currentPin: z
    .string()
    .regex(/^\d{4}$/, "Current PIN must be exactly 4 numeric digits")
    .optional(),
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

    const orm = await getDb();
    const [existing] = await orm
      .select({ pinHash: schema.userPins.pinHash })
      .from(schema.userPins)
      .where(eq(schema.userPins.userId, auth.user.sub))
      .limit(1);

    if (existing) {
      if (!body.currentPin) {
        throw badRequest("Current PIN is required to change your PIN", "CURRENT_PIN_REQUIRED");
      }
      await requireCorrectPin(auth.user.sub, body.currentPin, existing.pinHash);
    } else {
      // First-time set: still refuse while a lockout is active for this account.
      await assertPinNotLocked(auth.user.sub);
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
    await orm
      .insert(schema.userPins)
      .values({ userId: auth.user.sub, pinHash })
      .onConflictDoUpdate({
        target: schema.userPins.userId,
        set: { pinHash, updatedAt: new Date() },
      });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
