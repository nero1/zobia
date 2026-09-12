export const dynamic = "force-dynamic";

/**
 * app/api/wiki/[slug]/collaborators/route.ts
 *
 * POST   /api/wiki/<slug>/collaborators  — add a selected collaborator (contribute_policy = 'selected')
 * DELETE /api/wiki/<slug>/collaborators  — remove a collaborator
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getWikiBySlug } from "@/lib/wiki/repo";
import { addSelectedCollaborator, removeCollaborator } from "@/lib/wiki/service";

const targetSchema = z.object({ userId: z.string().uuid() });

export const POST = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.wikiVote);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    const body = await validateBody(req, targetSchema);
    await addSelectedCollaborator(wiki.id, auth.user.sub, body.userId);
    return NextResponse.json({ success: true, data: { added: true }, error: null });
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
    await removeCollaborator(wiki.id, auth.user.sub, body.userId);
    return NextResponse.json({ success: true, data: { removed: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
