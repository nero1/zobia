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
import { getDb, schema } from "@/lib/db/drizzle";

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

    const orm = await getDb();
    await orm
      .insert(schema.xManifest)
      .values({ key, value: jsonValue, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.xManifest.key,
        set: { value: jsonValue, updatedAt: new Date() },
      });

    return NextResponse.json({ success: true, mode });
  } catch (err) {
    return handleApiError(err);
  }
});
