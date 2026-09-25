export const dynamic = 'force-dynamic';

/**
 * app/api/admin/auth/magic-word/route.ts
 *
 * GET  /api/admin/auth/magic-word  — whether the current admin has set a
 *      Secret Magic Word yet (never returns the word itself). Used by the
 *      "please set this up" reminder banner and the security settings page.
 * POST /api/admin/auth/magic-word  — set/replace the current admin's magic
 *      word. Requires the admin's current password to change (same pattern
 *      as other sensitive account changes) so a hijacked session can't
 *      silently swap in an attacker-known unlock phrase.
 */

import { NextRequest, NextResponse } from "next/server";
import { compare, hash } from "bcryptjs";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, unauthorized } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

const setMagicWordSchema = z.object({
  password: z.string().min(1, "Current password required"),
  magicWord: z.string().min(6, "Secret Magic Word must be at least 6 characters").max(200),
});

export const GET = withAdminAuth(async (_req, { auth }) => {
  try {
    const orm = await getDb();
    const [row] = await orm
      .select({ adminMagicWordHash: schema.users.adminMagicWordHash })
      .from(schema.users)
      .where(eq(schema.users.id, auth.user.sub))
      .limit(1);
    return NextResponse.json({
      success: true,
      data: { isSet: !!row?.adminMagicWordHash },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, setMagicWordSchema);

    const orm = await getDb();
    const [row] = await orm
      .select({ passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.id, auth.user.sub))
      .limit(1);
    const passwordValid = row?.passwordHash
      ? await compare(body.password, row.passwordHash)
      : false;
    if (!passwordValid) {
      throw unauthorized("Current password is incorrect.");
    }

    const magicWordHash = await hash(body.magicWord, 12);
    await orm
      .update(schema.users)
      .set({ adminMagicWordHash: magicWordHash })
      .where(eq(schema.users.id, auth.user.sub));

    return NextResponse.json({ success: true, data: { isSet: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
