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
import { db } from "@/lib/db";
import type { SqlParam } from "@/lib/db/interface";
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
    const { rows } = await db.query<{
      hd_send_enabled: boolean;
    }>(
      `SELECT COALESCE(hd_send_enabled, false) AS hd_send_enabled
       FROM users WHERE id = $1 LIMIT 1`,
      [auth.user.sub]
    );

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

    const updates: string[] = [];
    const values: SqlParam[] = [];
    let idx = 1;

    if (body.hd_send_enabled !== undefined) {
      updates.push(`hd_send_enabled = $${idx++}`);
      values.push(body.hd_send_enabled);
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: true, data: {} });
    }

    updates.push(`updated_at = NOW()`);
    values.push(auth.user.sub);

    await db.query(
      `UPDATE users SET ${updates.join(", ")} WHERE id = $${idx}`,
      values
    );

    return NextResponse.json({ success: true, data: body });
  } catch (err) {
    return handleApiError(err);
  }
});
