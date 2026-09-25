export const dynamic = 'force-dynamic';

/**
 * app/api/settings/route.ts
 *
 * User preference settings.
 *
 * GET  /api/settings — Return the caller's current settings.
 * PATCH /api/settings — Update one or more settings fields.
 *
 * Supported settings:
 *   hd_send_enabled (boolean) — PRD §5: HD send on Wi-Fi toggle.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const patchSettingsSchema = z.object({
  hd_send_enabled: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// GET /api/settings
// ---------------------------------------------------------------------------

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const orm = await getDb();
    const rows = await orm
      .select({ hd_send_enabled: sql<boolean>`COALESCE(${schema.users.hdSendEnabled}, false)` })
      .from(schema.users)
      .where(eq(schema.users.id, auth.user.sub))
      .limit(1);

    return NextResponse.json({
      success: true,
      data: rows[0] ?? { hd_send_enabled: false },
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/settings
// ---------------------------------------------------------------------------

export const PATCH = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, patchSettingsSchema);

    if (body.hd_send_enabled === undefined) {
      return NextResponse.json({ success: true, data: {} });
    }

    const orm = await getDb();
    await orm
      .update(schema.users)
      .set({ hdSendEnabled: body.hd_send_enabled, updatedAt: sql`NOW()` })
      .where(eq(schema.users.id, auth.user.sub));

    return NextResponse.json({ success: true, data: body });
  } catch (err) {
    return handleApiError(err);
  }
});
