export const dynamic = 'force-dynamic';

/**
 * app/api/business/pages/[pageId]/posts/[postId]/route.ts
 *
 * PATCH  — edit a post (title/body/image/status).
 * DELETE — soft-delete a post.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import type { SqlParam } from "@/lib/db";
import { withAuth, validateBody, type AuthContext } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { isUserModeratorOrAdmin } from "@/lib/forum/service";

interface Ctx {
  params: Promise<{ pageId: string; postId: string }>;
  auth: AuthContext;
}

const updatePostSchema = z.object({
  title: z.string().min(2).max(150).optional(),
  body: z.string().min(2).max(5000).optional(),
  imageUrl: z.string().url().max(500).nullable().optional(),
  status: z.enum(["draft", "published"]).optional(),
});

async function assertOwnerOrModerator(pageId: string, postId: string, userId: string): Promise<{ status: string }> {
  const { rows } = await db.query<{ owner_user_id: string; status: string }>(
    `SELECT ba.user_id AS owner_user_id, bpp.status
     FROM business_page_posts bpp
     JOIN business_pages bp ON bp.id = bpp.page_id
     JOIN business_accounts ba ON ba.id = bp.business_account_id
     WHERE bpp.id = $1 AND bpp.page_id = $2 AND bpp.deleted_at IS NULL LIMIT 1`,
    [postId, pageId]
  );
  if (!rows[0]) throw notFound("Post not found");
  if (rows[0].owner_user_id !== userId && !(await isUserModeratorOrAdmin(userId))) {
    throw forbidden("Only the page owner or a moderator can manage this post.");
  }
  return { status: rows[0].status };
}

export const PATCH = withAuth(async (req: NextRequest, { params, auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { pageId, postId } = await params;
    const before = await assertOwnerOrModerator(pageId, postId, auth.user.sub);

    const body = await validateBody(req, updatePostSchema);
    const setParts: string[] = ["updated_at = NOW()"];
    const values: SqlParam[] = [postId];
    let idx = 2;
    const fieldMap: Record<string, string> = { title: "title", body: "body", imageUrl: "image_url", status: "status" };
    for (const [jsKey, col] of Object.entries(fieldMap)) {
      const val = (body as Record<string, unknown>)[jsKey];
      if (val !== undefined) {
        setParts.push(`${col} = $${idx++}`);
        values.push(val as SqlParam);
      }
    }
    if (setParts.length > 1) {
      await db.query(`UPDATE business_page_posts SET ${setParts.join(", ")} WHERE id = $1`, values);
    }

    // Keep the page's published post_count accurate if status transitioned.
    if (body.status && body.status !== before.status) {
      if (body.status === "published") {
        await db.query(`UPDATE business_pages SET post_count = post_count + 1, updated_at = NOW() WHERE id = $1`, [pageId]);
      } else if (before.status === "published") {
        await db.query(`UPDATE business_pages SET post_count = GREATEST(post_count - 1, 0), updated_at = NOW() WHERE id = $1`, [pageId]);
      }
    }

    return NextResponse.json({ success: true, data: { postId }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth(async (_req: NextRequest, { params, auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { pageId, postId } = await params;
    const before = await assertOwnerOrModerator(pageId, postId, auth.user.sub);

    await db.query(`UPDATE business_page_posts SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [postId]);
    if (before.status === "published") {
      await db.query(`UPDATE business_pages SET post_count = GREATEST(post_count - 1, 0), updated_at = NOW() WHERE id = $1`, [pageId]);
    }

    return NextResponse.json({ success: true, data: { postId, deleted: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
