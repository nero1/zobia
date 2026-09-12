export const dynamic = "force-dynamic";

/**
 * app/api/wiki/[slug]/treasury/route.ts
 *
 * GET  /api/wiki/<slug>/treasury  — current reward pot state
 * POST /api/wiki/<slug>/treasury  — fund/top-up the pot (owner only, Credits)
 *
 * First `maxClaimants` distinct users who contribute a page (create/edit) or
 * share the wiki split `amount` evenly — see lib/contentTreasury.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getWikiBySlug } from "@/lib/wiki/repo";
import { fundWikiTreasury, getWikiTreasury } from "@/lib/wiki/service";

const fundSchema = z.object({
  amount: z.number().int().positive().max(1_000_000),
  maxClaimants: z.number().int().positive().max(10_000),
});

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    const treasury = await getWikiTreasury(wiki.id);
    return NextResponse.json({ success: true, data: { treasury }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.wikiWrite);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    const body = await validateBody(req, fundSchema);
    const treasury = await fundWikiTreasury(wiki.id, auth.user.sub, body.amount, body.maxClaimants);
    return NextResponse.json({ success: true, data: { treasury }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
