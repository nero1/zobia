export const dynamic = 'force-dynamic';

/**
 * app/api/admin/email-settings/route.ts
 *
 * GET  /api/admin/email-settings  – Return current platform email settings
 * PUT  /api/admin/email-settings  – Update platform email settings
 *
 * Manages platform-wide email toggles per PRD §16 and §20:
 *   - email_all_enabled:        ALL email on/off (overrides everything)
 *   - email_non_critical_enabled: Non-critical email on/off
 *
 * Admin-only endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, forbidden } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const emailSettingsSchema = z.object({
  email_all_enabled:         z.boolean().optional(),
  email_non_critical_enabled: z.boolean().optional(),
}).strict();

// ---------------------------------------------------------------------------
// GET /api/admin/email-settings
// ---------------------------------------------------------------------------

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    if (!auth.user.is_admin) throw forbidden("Admin access required");

    const { rows } = await db.query<{ key: string; value: string }>(
      `SELECT key, value FROM x_manifest
       WHERE key IN ('email_all_enabled', 'email_non_critical_enabled')`,
    );

    const settings: Record<string, boolean> = {
      email_all_enabled: true,
      email_non_critical_enabled: true,
    };

    for (const row of rows) {
      settings[row.key] = row.value === "true";
    }

    return NextResponse.json({
      success: true,
      data: settings,
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/admin/email-settings
// ---------------------------------------------------------------------------

export const PUT = withAuth(async (req: NextRequest, { auth }) => {
  try {
    if (!auth.user.is_admin) throw forbidden("Admin access required");

    const body = await validateBody(req, emailSettingsSchema);

    const updates: Array<{ key: string; value: string }> = [];
    if (body.email_all_enabled !== undefined) {
      updates.push({ key: "email_all_enabled", value: String(body.email_all_enabled) });
    }
    if (body.email_non_critical_enabled !== undefined) {
      updates.push({ key: "email_non_critical_enabled", value: String(body.email_non_critical_enabled) });
    }

    for (const update of updates) {
      await db.query(
        `INSERT INTO x_manifest (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [update.key, update.value]
      );
    }

    return NextResponse.json({
      success: true,
      data: { updated: updates.map((u) => u.key) },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
