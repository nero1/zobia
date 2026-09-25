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
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
  const orm = await getDb();
  const [row] = await orm
    .select({
      owner_user_id: schema.businessAccounts.userId,
      status: schema.businessPages.status,
    })
    .from(schema.businessPages)
    .innerJoin(
      schema.businessAccounts,
      eq(schema.businessAccounts.id, schema.businessPages.businessAccountId)
    )
    .where(and(eq(schema.businessPages.id, pageId), isNull(schema.businessPages.deletedAt)))
    .limit(1);
  if (!row) throw notFound("Business page not found");
  if (row.owner_user_id !== userId && !(await isUserModeratorOrAdmin(userId))) {
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

    const orm = await getDb();
    const newPostId = await orm.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(schema.businessPagePosts)
        .values({
          pageId,
          title: body.title.trim(),
          body: body.body.trim(),
          imageUrl: body.imageUrl || null,
          status: body.status,
        })
        .returning({ id: schema.businessPagePosts.id });

      if (body.status === "published") {
        await tx
          .update(schema.businessPages)
          .set({ postCount: sql`${schema.businessPages.postCount} + 1`, updatedAt: new Date() })
          .where(eq(schema.businessPages.id, pageId));
      }
      return inserted.id;
    });

    return NextResponse.json({ success: true, data: { postId: newPostId }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
