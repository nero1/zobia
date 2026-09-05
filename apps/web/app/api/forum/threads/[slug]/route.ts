export const dynamic = "force-dynamic";

/**
 * app/api/forum/threads/[slug]/route.ts
 *
 * GET /api/forum/threads/[slug] — a thread with its posts (public). Bumps
 * the view count on each fetch (best-effort, not deduped per-viewer — good
 * enough for a stub; matches the low-Redis-usage constraint by not tracking
 * per-user view state at all).
 */

import { NextResponse } from "next/server";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, notFound } from "@/lib/api/errors";
import { getThreadBySlug, listPostsInThread, incrementThreadViewCount } from "@/lib/bbforum/repo";
import { db } from "@/lib/db";

export const GET = async (_req: Request, { params }: { params: Promise<{ slug: string }> }) => {
  try {
    await requireFeatureEnabled("bbforum");
    const { slug } = await params;
    const thread = await getThreadBySlug(slug);
    if (!thread) throw notFound("Thread not found");

    const [posts, boardRows] = await Promise.all([
      listPostsInThread(thread.id),
      db.query<{ slug: string; name: string }>(`SELECT slug, name FROM bb_boards WHERE id = $1`, [thread.board_id]),
    ]);

    void incrementThreadViewCount(thread.id).catch(() => {});

    return NextResponse.json({
      success: true,
      data: { thread, posts, board: boardRows.rows[0] ?? null },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
};
