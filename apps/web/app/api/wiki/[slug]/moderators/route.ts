export const dynamic = "force-dynamic";

/**
 * app/api/wiki/[slug]/moderators/route.ts
 *
 * GET    /api/wiki/<slug>/moderators  — list active collaborators (moderators first)
 * POST   /api/wiki/<slug>/moderators  — grant a collaborator moderator status (owner/admin)
 * DELETE /api/wiki/<slug>/moderators  — revoke moderator status (owner/admin)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getWikiBySlug, listCollaborators } from "@/lib/wiki/repo";
import { grantModerator, revokeModerator } from "@/lib/wiki/service";

const targetSchema = z.object({ userId: z.string().uuid() });

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    const collaborators = await listCollaborators(wiki.id);
    return NextResponse.json({ success: true, data: { collaborators }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.wikiVote);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    const body = await validateBody(req, targetSchema);
    await grantModerator(wiki.id, auth.user.sub, body.userId);
    return NextResponse.json({ success: true, data: { granted: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.wikiVote);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    const body = await validateBody(req, targetSchema);
    await revokeModerator(wiki.id, auth.user.sub, body.userId);
    return NextResponse.json({ success: true, data: { revoked: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
