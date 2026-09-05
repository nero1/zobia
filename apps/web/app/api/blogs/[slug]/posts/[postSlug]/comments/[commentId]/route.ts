export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/posts/[postSlug]/comments/[commentId]/route.ts
 *
 * PATCH  — moderate a comment: { action: "approve" | "remove" }.
 * DELETE — owner/moderator CRUD delete of any comment regardless of its
 *          current status (visible or pending) — distinct entry point from
 *          PATCH's approve/remove pending-queue actions, for the "manage
 *          all comments" dashboard view.
 * Both callable by the blog owner or a platform moderator/admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { moderateComment, deleteComment, isUserModeratorOrAdmin } from "@/lib/blogs/service";

const patchSchema = z.object({
  action: z.enum(["approve", "remove"]),
});

export const PATCH = withAuth<{ slug: string; postSlug: string; commentId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogWrite);
    const body = await validateBody(req, patchSchema);
    const isMod = await isUserModeratorOrAdmin(auth.user.sub);
    await moderateComment(params.commentId, auth.user.sub, isMod, body.action);
    return NextResponse.json({ success: true, data: { moderated: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ slug: string; postSlug: string; commentId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogWrite);
    const isMod = await isUserModeratorOrAdmin(auth.user.sub);
    await deleteComment(params.commentId, auth.user.sub, isMod);
    return NextResponse.json({ success: true, data: { deleted: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
