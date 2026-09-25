export const dynamic = 'force-dynamic';

/**
 * app/api/moments/[momentId]/route.ts
 *
 * GET    /api/moments/:momentId  — View a moment and record the view
 * DELETE /api/moments/:momentId  — Delete own moment
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";

export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const { momentId } = await params as { momentId: string };
    const viewerId = auth.user.sub;

    const orm = await getDb();

    const rows = await orm
      .select({
        id: schema.moments.id,
        userId: schema.moments.userId,
        content: schema.moments.content,
        contentType: schema.moments.contentType,
        mediaUrl: schema.moments.mediaUrl,
        thumbnailUrl: schema.moments.thumbnailUrl,
        caption: schema.moments.caption,
        viewCount: schema.moments.viewCount,
        reactionsCount: schema.moments.reactionsCount,
        expiresAt: schema.moments.expiresAt,
        createdAt: schema.moments.createdAt,
        username: schema.users.username,
        avatarEmoji: schema.users.avatarEmoji,
      })
      .from(schema.moments)
      .innerJoin(schema.users, eq(schema.users.id, schema.moments.userId))
      .where(and(eq(schema.moments.id, momentId), gt(schema.moments.expiresAt, sql`NOW()`)))
      .limit(1);

    if (!rows[0]) throw notFound("Moment not found or expired");

    void orm
      .insert(schema.momentViews)
      .values({ momentId, viewerId })
      .onConflictDoNothing()
      .then(() =>
        orm
          .update(schema.moments)
          .set({ viewCount: sql`${schema.moments.viewCount} + 1` })
          .where(eq(schema.moments.id, momentId))
      )
      .catch(() => {});

    return NextResponse.json({ success: true, data: rows[0], error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const { momentId } = await params as { momentId: string };
    const userId = auth.user.sub;

    const orm = await getDb();

    const rows = await orm
      .select({ userId: schema.moments.userId })
      .from(schema.moments)
      .where(eq(schema.moments.id, momentId))
      .limit(1);
    if (!rows[0]) throw notFound("Moment not found");
    if (rows[0].userId !== userId) throw forbidden("Cannot delete another user's moment");

    await orm.delete(schema.moments).where(eq(schema.moments.id, momentId));
    return NextResponse.json({ success: true, data: null, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
