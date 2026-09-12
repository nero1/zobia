export const dynamic = "force-dynamic";

/**
 * app/api/wiki/[slug]/pages/[pageSlug]/revisions/route.ts
 *
 * GET  /api/wiki/<slug>/pages/<pageSlug>/revisions  — revision history
 * POST /api/wiki/<slug>/pages/<pageSlug>/revisions  — restore an old revision (creates a new one)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getWikiBySlug, getWikiPageBySlug, listPageRevisions } from "@/lib/wiki/repo";
import { restorePageRevision } from "@/lib/wiki/service";

const restoreSchema = z.object({
  revisionNumber: z.number().int().positive(),
});

export const GET = withAuth<{ slug: string; pageSlug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    const page = await getWikiPageBySlug(wiki.id, params.pageSlug);
    if (!page) throw notFound("Page not found");
    const revisions = await listPageRevisions(page.id);
    return NextResponse.json({ success: true, data: { revisions }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ slug: string; pageSlug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.wikiWrite);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    const page = await getWikiPageBySlug(wiki.id, params.pageSlug);
    if (!page) throw notFound("Page not found");
    const body = await validateBody(req, restoreSchema);
    await restorePageRevision(page.id, auth.user.sub, body.revisionNumber);
    return NextResponse.json({ success: true, data: { restored: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
