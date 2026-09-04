export const dynamic = 'force-dynamic';

/**
 * app/api/admin/auth/unlock/route.ts
 *
 * POST /api/admin/auth/unlock
 *
 * Unlocks an admin account that was locked after 3 failed login attempts
 * (see lib/auth/adminLockout.ts) by verifying the "Secret Magic Word" the
 * admin set in advance while logged in (POST /api/admin/auth/magic-word).
 *
 * No session is issued here — a successful unlock just clears the failure
 * counter so the admin can retry the normal credentials + TOTP login flow.
 */

import { NextRequest, NextResponse } from "next/server";
import { compare, hash } from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleApiError, unauthorized } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/middleware";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { isAdminLockedOut, clearAdminLockout } from "@/lib/auth/adminLockout";

const unlockSchema = z.object({
  email: z.string().email("Valid email required"),
  magicWord: z.string().min(1, "Secret Magic Word required"),
});

interface AdminUserRow {
  id: string;
  is_admin: boolean;
  admin_magic_word_hash: string | null;
}

// Constant-time comparison sentinel for accounts with no magic word set / not found.
const DUMMY_HASH_PROMISE = hash("timing-equalization-sentinel", 12);

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Tight IP limit — this endpoint exists specifically to be a brute-force target.
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.pinVerify);

    const body = await validateBody(req, unlockSchema);

    if (!(await isAdminLockedOut(body.email))) {
      // Nothing to unlock — don't leak whether the email exists.
      return NextResponse.json({ success: true, wasLocked: false }, { status: 200 });
    }

    const { rows } = await db.query<AdminUserRow>(
      `SELECT id, is_admin, admin_magic_word_hash FROM users WHERE email = $1 LIMIT 1`,
      [body.email.toLowerCase()]
    );
    const user = rows[0];

    const magicWordHash = user?.admin_magic_word_hash ?? (await DUMMY_HASH_PROMISE);
    const valid = await compare(body.magicWord, magicWordHash);

    if (!user || !user.is_admin || !user.admin_magic_word_hash || !valid) {
      throw unauthorized("Incorrect Secret Magic Word.");
    }

    await clearAdminLockout(body.email);

    return NextResponse.json({ success: true, wasLocked: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
}
