export const dynamic = "force-dynamic";

/**
 * app/api/wiki/[slug]/pages/[pageSlug]/route.ts
 *
 * GET    /api/wiki/<slug>/pages/<pageSlug>  — page detail (records a view)
 * PATCH  /api/wiki/<slug>/pages/<pageSlug>  — edit the page (creates a new revision)
 * DELETE /api/wiki/<slug>/pages/<pageSlug>  — delete the page (owner/moderator/admin)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getWikiBySlug, getWikiPageBySlug } from "@/lib/wiki/repo";
import { updatePage, deletePage, recordPageView } from "@/lib/wiki/service";
import { canManageWiki, canContributeToWiki } from "@/lib/wiki/permissions";

const updatePageSchema = z.object({
  title: z.string().trim().min(1).max(150).optional(),
  contentMarkdown: z.string().trim().min(1).max(50_000).optional(),
  contentFormat: z.enum(["markdown", "plaintext"]).optional(),
  editSummary: z.string().trim().max(300).optional().nullable(),
});

export const GET = withAuth<{ slug: string; pageSlug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    const page = await getWikiPageBySlug(wiki.id, params.pageSlug);
    if (!page) throw notFound("Page not found");

    const [canManage, canContribute] = await Promise.all([
      canManageWiki(wiki, auth.user.sub),
      canContributeToWiki(wiki, auth.user.sub),
    ]);

    recordPageView(page.id).catch(() => {});

    return NextResponse.json({ success: true, data: { wiki, page, canManage, canContribute }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const PATCH = withAuth<{ slug: string; pageSlug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.wikiWrite);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    const page = await getWikiPageBySlug(wiki.id, params.pageSlug);
    if (!page) throw notFound("Page not found");
    const body = await validateBody(req, updatePageSchema);
    await updatePage(page.id, auth.user.sub, body);
    return NextResponse.json({ success: true, data: { updated: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ slug: string; pageSlug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.wikiWrite);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    const page = await getWikiPageBySlug(wiki.id, params.pageSlug);
    if (!page) throw notFound("Page not found");
    await deletePage(page.id, auth.user.sub);
    return NextResponse.json({ success: true, data: { deleted: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
