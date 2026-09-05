export const dynamic = "force-dynamic";

/**
 * app/api/forum/boards/[boardSlug]/threads/route.ts
 *
 * GET  — paginated thread list for a board (public, cursor pagination).
 * POST — start a new thread (auth required).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled, getManifestValue } from "@/lib/manifest";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBoardBySlug, listThreadsInBoard, createThread } from "@/lib/bbforum/repo";
import { db } from "@/lib/db";

const createSchema = z.object({
  title: z.string().min(5).max(200),
  body: z.string().min(10).max(20000),
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
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { boardSlug } = await params;
    const board = await getBoardBySlug(boardSlug);
    if (!board) throw notFound("Board not found");

    const { rows } = await db.query<{ rank_level: number }>(`SELECT COALESCE(rank_level, 1) AS rank_level FROM users WHERE id = $1`, [auth.user.sub]);
    const minLevelRaw = await getManifestValue("bbforum_min_level_to_post");
    const minLevel = minLevelRaw ? parseInt(minLevelRaw, 10) : 1;
    if ((rows[0]?.rank_level ?? 1) < minLevel) {
      throw forbidden(`Reach level ${minLevel} to start a thread.`, "BBFORUM_LEVEL_TOO_LOW");
    }

    const body = await validateBody(req, createSchema);
    const thread = await createThread({ boardId: board.id, authorId: auth.user.sub, title: body.title, body: body.body });
    return NextResponse.json({ success: true, data: { thread }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
