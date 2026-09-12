export const dynamic = "force-dynamic";

/**
 * app/api/wiki/[slug]/invites/route.ts
 *
 * GET  /api/wiki/<slug>/invites  — list invites (owner/moderator)
 * POST /api/wiki/<slug>/invites  — create an invite (optionally targeted at a username)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getWikiBySlug, listWikiInvites } from "@/lib/wiki/repo";
import { createInvite } from "@/lib/wiki/service";
import { canManageWiki } from "@/lib/wiki/permissions";

const createInviteSchema = z.object({
  username: z.string().trim().min(1).max(50).optional(),
});

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    if (!(await canManageWiki(wiki, auth.user.sub))) throw forbidden("Only the wiki owner or a moderator can view invites.");
    const invites = await listWikiInvites(wiki.id);
    return NextResponse.json({ success: true, data: { invites }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.wikiVote);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    const body = await validateBody(req, createInviteSchema);
    const result = await createInvite({ wikiId: wiki.id, callerId: auth.user.sub, invitedUsername: body.username });
    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
