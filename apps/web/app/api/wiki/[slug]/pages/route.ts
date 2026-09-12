export const dynamic = "force-dynamic";

/**
 * app/api/wiki/[slug]/pages/route.ts
 *
 * GET  /api/wiki/<slug>/pages  — cursor-paginated page list (search by title)
 * POST /api/wiki/<slug>/pages  — create a new page (any eligible contributor)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getWikiBySlug, listWikiPages } from "@/lib/wiki/repo";
import { createPage } from "@/lib/wiki/service";

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.string().optional().transform((v) => (v ? Math.min(parseInt(v, 10), 100) : 50)),
  q: z.string().optional(),
});

const createPageSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(150),
  contentMarkdown: z.string().trim().min(1, "Content is required").max(50_000),
  contentFormat: z.enum(["markdown", "plaintext"]).optional(),
});

export const GET = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    const query = validateSearchParams(req.nextUrl.searchParams, listQuerySchema);
    const result = await listWikiPages(wiki.id, { cursor: query.cursor ?? null, limit: query.limit, search: query.q });
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.wikiWrite);
    const wiki = await getWikiBySlug(params.slug);
    if (!wiki) throw notFound("Wiki not found");
    const body = await validateBody(req, createPageSchema);
    const result = await createPage({
      wikiId: wiki.id,
      authorId: auth.user.sub,
      title: body.title,
      contentMarkdown: body.contentMarkdown,
      contentFormat: body.contentFormat,
    });
    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
