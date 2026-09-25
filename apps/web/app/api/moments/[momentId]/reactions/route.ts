export const dynamic = 'force-dynamic';

/**
 * app/api/moments/[momentId]/reactions/route.ts
 *
 * POST   /api/moments/:momentId/reactions  — Add a reaction to a moment
 * DELETE /api/moments/:momentId/reactions  — Remove own reaction from a moment
 *
 * PRD §5: Zobia Moments — viewers can react with emoji.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Allowed reaction emojis
// ---------------------------------------------------------------------------

const ALLOWED_REACTIONS = ["❤️", "🔥", "😂", "😮", "👏", "💯", "🎉", "👀"];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const addReactionSchema = z.object({
  emoji: z.string().min(1).max(8),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getMoment(momentId: string): Promise<{ id: string } | null> {
  const orm = await getDb();
  const rows = await orm
    .select({ id: schema.moments.id })
    .from(schema.moments)
    .where(and(eq(schema.moments.id, momentId), gt(schema.moments.expiresAt, sql`NOW()`)))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// POST /api/moments/[momentId]/reactions
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { momentId } = await params as { momentId: string };
    const userId = auth.user.sub;

    const body = await validateBody(req, addReactionSchema);
    const emoji = (body as { emoji: string }).emoji;

    if (!ALLOWED_REACTIONS.includes(emoji)) {
      throw badRequest(`Unsupported reaction. Allowed: ${ALLOWED_REACTIONS.join(" ")}`);
    }

    const moment = await getMoment(momentId);
    if (!moment) throw notFound("Moment not found or expired");

    const orm = await getDb();

    // Upsert reaction (one reaction per user per moment — toggle emoji)
    await orm
      .insert(schema.momentReactions)
      .values({ momentId, userId, emoji })
      .onConflictDoUpdate({
        target: [schema.momentReactions.momentId, schema.momentReactions.userId],
        set: { emoji, createdAt: sql`NOW()` },
      });

    // Refresh cached reaction counts on the moment row
    await orm
      .update(schema.moments)
      .set({
        reactionsCount: sql`(SELECT COUNT(*) FROM ${schema.momentReactions} WHERE ${schema.momentReactions.momentId} = ${momentId})`,
      })
      .where(eq(schema.moments.id, momentId))
      .catch(() => {});

    // Return updated reaction summary
    const summary = await orm
      .select({
        emoji: schema.momentReactions.emoji,
        count: count(),
        userReacted: sql<boolean>`BOOL_OR(${schema.momentReactions.userId} = ${userId})`,
      })
      .from(schema.momentReactions)
      .where(eq(schema.momentReactions.momentId, momentId))
      .groupBy(schema.momentReactions.emoji)
      .orderBy(sql`count(*) DESC`);

    return NextResponse.json({
      success: true,
      data: {
        reactions: summary.map((r) => ({
          emoji: r.emoji,
          count: Number(r.count),
          userReacted: r.userReacted,
        })),
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/moments/[momentId]/reactions
// ---------------------------------------------------------------------------

export const DELETE = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { momentId } = await params as { momentId: string };
    const userId = auth.user.sub;

    const moment = await getMoment(momentId);
    if (!moment) throw notFound("Moment not found or expired");

    const orm = await getDb();

    await orm
      .delete(schema.momentReactions)
      .where(and(eq(schema.momentReactions.momentId, momentId), eq(schema.momentReactions.userId, userId)));

    // Refresh cached count
    await orm
      .update(schema.moments)
      .set({
        reactionsCount: sql`(SELECT COUNT(*) FROM ${schema.momentReactions} WHERE ${schema.momentReactions.momentId} = ${momentId})`,
      })
      .where(eq(schema.moments.id, momentId))
      .catch(() => {});

    return NextResponse.json({ success: true, data: null, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
