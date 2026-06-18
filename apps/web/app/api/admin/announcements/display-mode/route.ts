export const dynamic = 'force-dynamic';

/**
 * app/api/admin/announcements/display-mode/route.ts
 *
 * PUT /api/admin/announcements/display-mode
 *   Updates the announcement display mode in x_manifest.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";

const DisplayModeSchema = z.object({
  mode: z.enum(["sequential", "serial", "all", "random"]),
  type: z.enum(["modal", "banner"]).default("modal"),
});

export const PUT = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await req.json().catch(() => ({}));
    const parsed = DisplayModeSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid display mode", parsed.error.flatten());
    }

    const { mode, type } = parsed.data;
    const key = type === "banner" ? "announcement_banner_mode" : "announcement_modal_display_mode";
    const jsonValue = JSON.stringify(mode);

    await db.query(
      `INSERT INTO x_manifest (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, jsonValue]
    );

    return NextResponse.json({ success: true, mode });
  } catch (err) {
    return handleApiError(err);
  }
});
