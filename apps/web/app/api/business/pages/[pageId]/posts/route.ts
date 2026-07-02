export const dynamic = 'force-dynamic';

/**
 * app/api/business/pages/[pageId]/posts/route.ts
 *
 * GET  — list a page's posts (owner or moderator only; mirrors the page's
 *   own auth check, since posts aren't public content in this iteration).
 * POST — create a post ("post stuff" — PRD §17 Business Pages).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody, type AuthContext } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { isUserModeratorOrAdmin } from "@/lib/forum/service";
import { listBusinessPagePosts } from "@/lib/business/repo";

interface Ctx {
  params: Promise<{ pageId: string }>;
  auth: AuthContext;
}

const createPostSchema = z.object({
  title: z.string().min(2).max(150),
  body: z.string().min(2).max(5000),
  imageUrl: z.string().url().max(500).optional().nullable(),
  status: z.enum(["draft", "published"]).default("published"),
});

async function assertOwnerOrModerator(pageId: string, userId: string): Promise<void> {
  const { rows } = await db.query<{ owner_user_id: string; status: string }>(
    `SELECT ba.user_id AS owner_user_id, bp.status
     FROM business_pages bp
     JOIN business_accounts ba ON ba.id = bp.business_account_id
     WHERE bp.id = $1 AND bp.deleted_at IS NULL LIMIT 1`,
    [pageId]
  );
  if (!rows[0]) throw notFound("Business page not found");
  if (rows[0].owner_user_id !== userId && !(await isUserModeratorOrAdmin(userId))) {
    throw forbidden("Only the page owner or a moderator can manage this page.");
  }
}

export const GET = withAuth(async (_req: NextRequest, { params, auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const { pageId } = await params;
    await assertOwnerOrModerator(pageId, auth.user.sub);
    const posts = await listBusinessPagePosts(pageId);
    return NextResponse.json({ success: true, data: { posts }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { params, auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { pageId } = await params;
    await assertOwnerOrModerator(pageId, auth.user.sub);

    const body = await validateBody(req, createPostSchema);

    const { rows } = await db.transaction(async (tx) => {
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO business_page_posts (page_id, title, body, image_url, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING id`,
        [pageId, body.title.trim(), body.body.trim(), body.imageUrl || null, body.status]
      );
      if (body.status === "published") {
        await tx.query(`UPDATE business_pages SET post_count = post_count + 1, updated_at = NOW() WHERE id = $1`, [pageId]);
      }
      return inserted;
    });

    return NextResponse.json({ success: true, data: { postId: rows[0].id }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
