export const dynamic = "force-dynamic";

/**
 * app/api/admin/blogs/[id]/status/route.ts
 *
 * PATCH /api/admin/blogs/<id>/status — moderator/admin action on a blog:
 *   { action: "suspend" | "ban" | "deactivate" | "pause" | "restore" | "delete", reason?: string }
 * Every action is recorded in blog_moderation_log.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withModeratorOrAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { setBlogStatus } from "@/lib/blogs/service";

const patchSchema = z.object({
  action: z.enum(["suspend", "ban", "deactivate", "pause", "restore", "delete"]),
  reason: z.string().trim().max(500).optional().nullable(),
});

export const PATCH = withModeratorOrAdminAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, patchSchema);
    await setBlogStatus(params.id, auth.user.sub, body.action, body.reason);
    return NextResponse.json({ success: true, data: { action: body.action }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
