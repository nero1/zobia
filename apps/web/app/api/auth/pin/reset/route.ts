export const dynamic = 'force-dynamic';

/**
 * app/api/auth/pin/reset/route.ts
 *
 * POST /api/auth/pin/reset
 *
 * "Forgot my PIN": set a new PIN WITHOUT knowing the old one, after proving
 * identity another way. Accepted proofs, in order of strength:
 *   1. `totpCode`  - a current authenticator code (when 2FA is enabled)
 *   2. `password`  - the account password (when one is set)
 *   3. neither supplied - allowed only if this session was created within the
 *      last 10 minutes (a fresh sign-in via Google/Telegram is the
 *      re-authentication; a long-lived stolen session cannot reset the PIN).
 *
 * If the account has 2FA enabled, a TOTP code is ALWAYS required (a fresh
 * session alone is not enough). A successful reset also clears any PIN
 * lockout and invalidates the current "PIN verified" window.
 *
 * Attempts at the password / TOTP proofs are rate limited via
 * RATE_LIMITS.pinVerify (5 / 15 min).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getManifestValue } from "@/lib/manifest";
import { getSession } from "@/lib/auth/session";
import { decryptField } from "@/lib/security/fieldEncryption";
import { verifyTotp } from "@/lib/auth/totp";
import { redis } from "@/lib/redis";
import { resetPinLockout } from "@/lib/auth/pinAttempts";
import { pinOkKey } from "@/lib/auth/pinGuard";
import { logger } from "@/lib/logger";

const BCRYPT_ROUNDS = 12;
/** A session younger than this counts as a fresh re-authentication. */
const FRESH_SESSION_MS = 10 * 60 * 1000;

const resetPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 numeric digits"),
  confirmPin: z.string().regex(/^\d{4}$/, "Confirm PIN must be exactly 4 numeric digits"),
  totpCode: z.string().regex(/^\d{6}$/, "Authenticator code must be 6 digits").optional(),
  password: z.string().min(1).max(200).optional(),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.pinVerify);

    if ((await getManifestValue("feature_pin_auth")) === "false") {
      return NextResponse.json(
        { error: "PIN authentication is not enabled on this platform", code: "FEATURE_DISABLED" },
        { status: 403 }
      );
    }

    const body = await validateBody(req, resetPinSchema);
    if (body.pin !== body.confirmPin) {
      throw badRequest("PIN and confirmation do not match", "PIN_MISMATCH");
    }

    const orm = await getDb();
    const [user] = await orm
      .select({
        passwordHash: schema.users.passwordHash,
        totpSecret: schema.users.totpSecret,
        totpEnabled: schema.users.totpEnabled,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) throw forbidden("Account not found", "AUTH_INVALID");

    const hasTotp = !!user.totpEnabled && !!user.totpSecret;
    let proven = false;

    if (body.totpCode) {
      if (!hasTotp) throw badRequest("Authenticator codes are not enabled on this account", "TOTP_NOT_ENABLED");
      const secret = decryptField(user.totpSecret!);
      if (!secret || !verifyTotp(secret, body.totpCode)) {
        throw forbidden("Incorrect authenticator code", "AUTH_INVALID");
      }
      // Anti-replay, same guard used by every other TOTP consumer.
      const marked = await redis.set(`totp:used:${userId}:${body.totpCode}`, "1", "EX", 90, "NX");
      if (marked === null) throw forbidden("Authenticator code already used. Wait for a new code.", "TOTP_REPLAY");
      proven = true;
    } else if (hasTotp) {
      throw forbidden("Authenticator code required to reset your PIN", "AUTH_REQUIRED");
    } else if (body.password) {
      if (!user.passwordHash || !(await bcrypt.compare(body.password, user.passwordHash))) {
        throw forbidden("Incorrect password", "AUTH_INVALID");
      }
      proven = true;
    } else {
      const session = await getSession(auth.user.sid);
      const ageMs = session ? Date.now() - new Date(session.created_at).getTime() : Infinity;
      if (ageMs > FRESH_SESSION_MS) {
        throw forbidden(
          "Please sign in again to reset your PIN, or confirm with your password.",
          "REAUTH_REQUIRED"
        );
      }
      proven = true;
    }
    if (!proven) throw forbidden("Identity check failed", "AUTH_INVALID");

    const pinHash = await bcrypt.hash(body.pin, BCRYPT_ROUNDS);
    await orm
      .insert(schema.userPins)
      .values({ userId, pinHash })
      .onConflictDoUpdate({ target: schema.userPins.userId, set: { pinHash, updatedAt: new Date() } });

    await resetPinLockout(userId);
    await redis.del(pinOkKey(userId, auth.user.sid)).catch(() => {});
    logger.info({ userId }, "[pin/reset] PIN reset after identity re-verification");

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
