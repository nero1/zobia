export const dynamic = "force-dynamic";

/**
 * app/api/forum/boards/[boardSlug]/threads/route.ts
 *
 * GET  — paginated thread list for a board (public, cursor pagination).
 * POST — start a new thread (auth required). Delegates eligibility, content
 * moderation, image-cost charging, and pot funding to lib/bbforum/service.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBoardBySlug, listThreadsInBoard } from "@/lib/bbforum/repo";
import { createThread } from "@/lib/bbforum/service";

const createSchema = z.object({
  title: z.string().min(5).max(200),
  body: z.string().min(10).max(20000),
  contentFormat: z.enum(["plaintext", "markdown"]).default("plaintext"),
  imageUrl: z.string().url().max(1000).optional(),
  potPerClaimCredits: z.number().int().min(0).max(100_000).optional(),
  potMaxClaims: z.number().int().min(0).max(1000).optional(),
});

export const GET = async (req: NextRequest, { params }: { params: Promise<{ boardSlug: string }> }) => {
  try {
    await requireFeatureEnabled("bbforum");
    const { boardSlug } = await params;
    const board = await getBoardBySlug(boardSlug);
    if (!board) throw notFound("Board not found");

    const url = new URL(req.url);
    const cursor = url.searchParams.get("cursor");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "30", 10) || 30, 50);

    const page = await listThreadsInBoard(board.id, limit, cursor);
    return NextResponse.json({ success: true, data: { board, ...page }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
};

export const POST = withAuth(async (req: NextRequest, { params, auth }: { params: Promise<{ boardSlug: string }>; auth: { user: { sub: string } } }) => {
  try {
    await requireFeatureEnabled("bbforum");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.forumWrite);
    const { boardSlug } = await params;

    const body = await validateBody(req, createSchema);
    const { thread } = await createThread({
      userId: auth.user.sub,
      boardSlug,
      title: body.title,
      body: body.body,
      contentFormat: body.contentFormat,
      imageUrl: body.imageUrl ?? null,
      potPerClaimCredits: body.potPerClaimCredits,
      potMaxClaims: body.potMaxClaims,
    });
    return NextResponse.json({ success: true, data: { thread }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
