export const dynamic = "force-dynamic";

/**
 * app/api/forum/threads/[slug]/route.ts
 *
 * GET   — a thread with its posts (public). Bumps the view count on each
 *         fetch (best-effort, not deduped per-viewer — matches the
 *         low-Redis-usage constraint by not tracking per-user view state).
 * PATCH — edit title (author/moderator), or lock/pin (moderator only).
 * DELETE — remove the thread (author/moderator) — soft-deletes via the OP post.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getThreadBySlug, listPostsInThread, incrementThreadViewCount, setThreadLocked, setThreadPinned, getPostById } from "@/lib/bbforum/repo";
import { editThreadTitle, deletePost, isUserModeratorOrAdmin } from "@/lib/bbforum/service";
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

const patchSchema = z.object({
  title: z.string().min(5).max(200).optional(),
  isLocked: z.boolean().optional(),
  isPinned: z.boolean().optional(),
});

export const PATCH = withAuth(async (req: NextRequest, { params, auth }: { params: Promise<{ slug: string }>; auth: { user: { sub: string } } }) => {
  try {
    await requireFeatureEnabled("bbforum");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { slug } = await params;
    const thread = await getThreadBySlug(slug);
    if (!thread) throw notFound("Thread not found");

    const body = await validateBody(req, patchSchema);
    if (body.title === undefined && body.isLocked === undefined && body.isPinned === undefined) {
      throw badRequest("Nothing to update");
    }

    const isModerator = await isUserModeratorOrAdmin(auth.user.sub);

    if (body.isLocked !== undefined || body.isPinned !== undefined) {
      if (!isModerator) throw forbidden("Only moderators can lock or pin threads.", "BBFORUM_MODERATOR_ONLY");
      if (body.isLocked !== undefined) await setThreadLocked(thread.id, body.isLocked);
      if (body.isPinned !== undefined) await setThreadPinned(thread.id, body.isPinned);
    }

    if (body.title !== undefined) {
      await editThreadTitle(thread.id, auth.user.sub, isModerator, body.title);
    }

    const updated = await getThreadBySlug(slug);
    return NextResponse.json({ success: true, data: { thread: updated }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth(async (_req: NextRequest, { params, auth }: { params: Promise<{ slug: string }>; auth: { user: { sub: string } } }) => {
  try {
    await requireFeatureEnabled("bbforum");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { slug } = await params;
    const thread = await getThreadBySlug(slug);
    if (!thread) throw notFound("Thread not found");

    const posts = await listPostsInThread(thread.id);
    const opPost = posts.find((p) => p.is_op) ?? posts[0];
    if (!opPost) throw notFound("Thread has no posts");
    const opRow = await getPostById(opPost.id);
    if (!opRow) throw notFound("Thread has no posts");

    const isModerator = await isUserModeratorOrAdmin(auth.user.sub);
    await deletePost(opRow.id, auth.user.sub, isModerator);

    return NextResponse.json({ success: true, data: { deleted: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
