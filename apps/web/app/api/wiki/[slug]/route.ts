export const dynamic = "force-dynamic";

/**
 * app/api/wiki/[slug]/route.ts
 *
 * GET   /api/wiki/<slug>  — wiki detail (any authenticated user)
 * PATCH /api/wiki/<slug>  — update wiki settings (owner only)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getWikiBySlug } from "@/lib/wiki/repo";
import { updateWikiSettings } from "@/lib/wiki/service";
import { canManageWiki, canContributeToWiki } from "@/lib/wiki/permissions";

const updateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
  coverImageUrl: z.string().url().max(500).optional().nullable(),
  contributePolicy: z.enum(["everyone", "friends", "selected"]).optional(),
});

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");

    const [canManage, canContribute] = await Promise.all([
      canManageWiki(wiki, auth.user.sub),
      canContributeToWiki(wiki, auth.user.sub),
    ]);

    return NextResponse.json({
      success: true,
      data: { wiki, isOwner: wiki.owner_id === auth.user.sub, canManage, canContribute },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const PATCH = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.wikiWrite);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    const body = await validateBody(req, updateSchema);
    await updateWikiSettings(wiki.id, auth.user.sub, body);
    return NextResponse.json({ success: true, data: { updated: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
