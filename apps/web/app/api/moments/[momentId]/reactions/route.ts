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
import { db } from "@/lib/db";
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
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM moments WHERE id = $1 AND expires_at > NOW() LIMIT 1`,
    [momentId]
  );
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

    // Upsert reaction (one reaction per user per moment — toggle emoji)
    await db.query(
      `INSERT INTO moment_reactions (moment_id, user_id, emoji, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (moment_id, user_id)
       DO UPDATE SET emoji = $3, created_at = NOW()`,
      [momentId, userId, emoji]
    );

    // Refresh cached reaction counts on the moment row
    await db.query(
      `UPDATE moments
       SET reactions_count = (
         SELECT COUNT(*) FROM moment_reactions WHERE moment_id = $1
       )
       WHERE id = $1`,
      [momentId]
    ).catch(() => {});

    // Return updated reaction summary
    const { rows: summary } = await db.query<{ emoji: string; count: string; user_reacted: boolean }>(
      `SELECT
         mr.emoji,
         COUNT(*) AS count,
         BOOL_OR(mr.user_id = $2) AS user_reacted
       FROM moment_reactions mr
       WHERE mr.moment_id = $1
       GROUP BY mr.emoji
       ORDER BY count DESC`,
      [momentId, userId]
    );

    return NextResponse.json({
      success: true,
      data: {
        reactions: summary.map((r) => ({
          emoji: r.emoji,
          count: parseInt(String(r.count), 10),
          userReacted: r.user_reacted,
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

    await db.query(
      `DELETE FROM moment_reactions WHERE moment_id = $1 AND user_id = $2`,
      [momentId, userId]
    );

    // Refresh cached count
    await db.query(
      `UPDATE moments
       SET reactions_count = (
         SELECT COUNT(*) FROM moment_reactions WHERE moment_id = $1
       )
       WHERE id = $1`,
      [momentId]
    ).catch(() => {});

    return NextResponse.json({ success: true, data: null, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
