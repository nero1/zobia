export const dynamic = 'force-dynamic';

/**
 * app/api/business/pages/[pageId]/route.ts
 *
 * GET    — page details + its posts (owner or platform moderator/admin only).
 * PATCH  — update name/bio/avatar/cover.
 * DELETE — remove the page, freeing a slot for the account's tier.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody, type AuthContext } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { isUserModeratorOrAdmin } from "@/lib/forum/service";
import { getBusinessPageById, listBusinessPagePosts } from "@/lib/business/repo";

interface PageCtx {
  params: Promise<{ pageId: string }>;
  auth: AuthContext;
}

const updatePageSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  bio: z.string().max(500).nullable().optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  coverImageUrl: z.string().url().max(500).nullable().optional(),
});

async function assertOwnerOrModerator(pageId: string, userId: string): Promise<{ pageId: string; businessAccountId: string }> {
  const orm = await getDb();
  const rows = await orm
    .select({
      id: schema.businessPages.id,
      businessAccountId: schema.businessPages.businessAccountId,
      ownerUserId: schema.businessAccounts.userId,
    })
    .from(schema.businessPages)
    .innerJoin(
      schema.businessAccounts,
      eq(schema.businessAccounts.id, schema.businessPages.businessAccountId)
    )
    .where(and(eq(schema.businessPages.id, pageId), isNull(schema.businessPages.deletedAt)))
    .limit(1);
  if (!rows[0]) throw notFound("Business page not found");
  if (rows[0].ownerUserId !== userId && !(await isUserModeratorOrAdmin(userId))) {
    throw forbidden("Only the page owner or a moderator can manage this page.");
  }
  return { pageId: rows[0].id, businessAccountId: rows[0].businessAccountId };
}

export const GET = withAuth(async (_req: NextRequest, { params, auth }: PageCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const { pageId } = await params;
    await assertOwnerOrModerator(pageId, auth.user.sub);

    const page = await getBusinessPageById(pageId);
    if (!page) throw notFound("Business page not found");
    const posts = await listBusinessPagePosts(pageId);

    return NextResponse.json({ success: true, data: { page, posts }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const PATCH = withAuth(async (req: NextRequest, { params, auth }: PageCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { pageId } = await params;
    await assertOwnerOrModerator(pageId, auth.user.sub);

    const body = await validateBody(req, updatePageSchema);
    const updates: Partial<typeof schema.businessPages.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.bio !== undefined) updates.bio = body.bio;
    if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl;
    if (body.coverImageUrl !== undefined) updates.coverImageUrl = body.coverImageUrl;

    if (Object.keys(updates).length > 1) {
      const orm = await getDb();
      await orm.update(schema.businessPages).set(updates).where(eq(schema.businessPages.id, pageId));
    }

    return NextResponse.json({ success: true, data: { pageId }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth(async (_req: NextRequest, { params, auth }: PageCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { pageId } = await params;
    await assertOwnerOrModerator(pageId, auth.user.sub);

    const orm = await getDb();
    await orm
      .update(schema.businessPages)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.businessPages.id, pageId));
    // Any sponsored quests attributed to this page keep their history but lose the live attribution.
    await orm
      .update(schema.sponsoredQuests)
      .set({ isActive: false })
      .where(and(eq(schema.sponsoredQuests.businessPageId, pageId), eq(schema.sponsoredQuests.isActive, true)));

    return NextResponse.json({ success: true, data: { pageId, deleted: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
