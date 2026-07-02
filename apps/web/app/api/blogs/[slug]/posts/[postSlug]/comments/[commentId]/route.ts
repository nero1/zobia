export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/posts/[postSlug]/comments/[commentId]/route.ts
 *
 * PATCH — moderate a comment: { action: "approve" | "remove" }.
 * Callable by the blog owner or a platform moderator/admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { moderateComment, isUserModeratorOrAdmin } from "@/lib/blogs/service";

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
