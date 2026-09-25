export const dynamic = 'force-dynamic';

/**
 * app/api/business/pages/[pageId]/posts/[postId]/route.ts
 *
 * PATCH  — edit a post (title/body/image/status).
 * DELETE — soft-delete a post.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
  const orm = await getDb();
  const rows = await orm
    .select({
      ownerUserId: schema.businessAccounts.userId,
      status: schema.businessPagePosts.status,
    })
    .from(schema.businessPagePosts)
    .innerJoin(schema.businessPages, eq(schema.businessPages.id, schema.businessPagePosts.pageId))
    .innerJoin(schema.businessAccounts, eq(schema.businessAccounts.id, schema.businessPages.businessAccountId))
    .where(
      and(
        eq(schema.businessPagePosts.id, postId),
        eq(schema.businessPagePosts.pageId, pageId),
        isNull(schema.businessPagePosts.deletedAt)
      )
    )
    .limit(1);
  if (!rows[0]) throw notFound("Post not found");
  if (rows[0].ownerUserId !== userId && !(await isUserModeratorOrAdmin(userId))) {
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
    const orm = await getDb();
    const updates: Partial<typeof schema.businessPagePosts.$inferInsert> = { updatedAt: new Date() };
    if (body.title !== undefined) updates.title = body.title;
    if (body.body !== undefined) updates.body = body.body;
    if (body.imageUrl !== undefined) updates.imageUrl = body.imageUrl;
    if (body.status !== undefined) updates.status = body.status;

    if (Object.keys(updates).length > 1) {
      await orm.update(schema.businessPagePosts).set(updates).where(eq(schema.businessPagePosts.id, postId));
    }

    // Keep the page's published post_count accurate if status transitioned.
    if (body.status && body.status !== before.status) {
      if (body.status === "published") {
        await orm
          .update(schema.businessPages)
          .set({ postCount: sql`${schema.businessPages.postCount} + 1`, updatedAt: new Date() })
          .where(eq(schema.businessPages.id, pageId));
      } else if (before.status === "published") {
        await orm
          .update(schema.businessPages)
          .set({ postCount: sql`GREATEST(${schema.businessPages.postCount} - 1, 0)`, updatedAt: new Date() })
          .where(eq(schema.businessPages.id, pageId));
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

    const orm = await getDb();
    await orm
      .update(schema.businessPagePosts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.businessPagePosts.id, postId));
    if (before.status === "published") {
      await orm
        .update(schema.businessPages)
        .set({ postCount: sql`GREATEST(${schema.businessPages.postCount} - 1, 0)`, updatedAt: new Date() })
        .where(eq(schema.businessPages.id, pageId));
    }

    return NextResponse.json({ success: true, data: { postId, deleted: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
