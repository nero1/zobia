export const dynamic = "force-dynamic";

/**
 * app/api/wiki/invites/[token]/route.ts
 *
 * GET  /api/wiki/invites/<token>  — invite preview (unauthenticated-safe shape, but requires login)
 * POST /api/wiki/invites/<token>  — accept the invite, joining as a collaborator
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getInviteByToken, getWikiById } from "@/lib/wiki/repo";
import { acceptInvite } from "@/lib/wiki/service";

export const GET = withAuth<{ token: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const invite = await getInviteByToken(params.token);
    if (!invite) throw notFound("Invite not found");
    const wiki = await getWikiById(invite.wiki_id);
    if (!wiki) throw notFound("Wiki not found");
    return NextResponse.json({
      success: true,
      data: {
        wiki: { slug: wiki.slug, name: wiki.name },
        expired: new Date(invite.expires_at) < new Date(),
        used: !!invite.used_at,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ token: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.wikiVote);
    const result = await acceptInvite(params.token, auth.user.sub);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
