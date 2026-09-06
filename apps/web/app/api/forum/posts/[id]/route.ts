export const dynamic = "force-dynamic";

/**
 * app/api/forum/posts/[id]/route.ts
 *
 * PATCH  — edit a post's body (author or moderator).
 * DELETE — remove a post (author or moderator). Deleting the OP post
 *          soft-deletes the whole thread (see lib/bbforum/repo.deletePost).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { editPost, deletePost, isUserModeratorOrAdmin } from "@/lib/bbforum/service";

const patchSchema = z.object({
  body: z.string().min(2).max(20000),
  contentFormat: z.enum(["plaintext", "markdown"]).default("plaintext"),
});

export const PATCH = withAuth(async (req: NextRequest, { params, auth }: { params: Promise<{ id: string }>; auth: { user: { sub: string } } }) => {
  try {
    await requireFeatureEnabled("bbforum");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { id } = await params;
    const body = await validateBody(req, patchSchema);
    const isModerator = await isUserModeratorOrAdmin(auth.user.sub);
    const post = await editPost(id, auth.user.sub, isModerator, body.body, body.contentFormat);
    return NextResponse.json({ success: true, data: { post }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth(async (_req: NextRequest, { params, auth }: { params: Promise<{ id: string }>; auth: { user: { sub: string } } }) => {
  try {
    await requireFeatureEnabled("bbforum");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { id } = await params;
    const isModerator = await isUserModeratorOrAdmin(auth.user.sub);
    await deletePost(id, auth.user.sub, isModerator);
    return NextResponse.json({ success: true, data: { deleted: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
