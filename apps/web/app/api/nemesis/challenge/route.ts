export const dynamic = 'force-dynamic';

/**
 * app/api/nemesis/challenge/route.ts
 *
 * POST /api/nemesis/challenge
 *
 * Starts a 7-day XP sprint challenge between the authenticated user
 * and their current nemesis. The sprint begins immediately and both
 * parties are notified.
 *
 * Gate: Competitor Track Level 40 required (PRD §7).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, conflict, forbidden } from "@/lib/api/errors";
import { getTrackLevelForXP } from "@/lib/xp/engine";

const MIN_COMPETITOR_LEVEL_FOR_CHALLENGE = 40;

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    const orm = await getDb();

    // Enforce Competitor Track Level 40 gate (PRD §7)
    const xpRows = await orm
      .select({ xpCompetitor: schema.users.xpCompetitor })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!xpRows[0]) throw notFound("User not found");

    const competitorXP = Number(xpRows[0].xpCompetitor ?? 0);
    const competitorTrackInfo = getTrackLevelForXP("competitor", competitorXP);
    if (competitorTrackInfo.level < MIN_COMPETITOR_LEVEL_FOR_CHALLENGE) {
      throw forbidden(
        `You must reach Competitor Track Level ${MIN_COMPETITOR_LEVEL_FOR_CHALLENGE} to challenge users to XP sprints.`,
        "LEVEL_GATE",
        { level: MIN_COMPETITOR_LEVEL_FOR_CHALLENGE }
      );
    }

    // Get current active nemesis
    const nemesisRows = await orm
      .select({ nemesisId: schema.nemesisAssignments.nemesisUserId })
      .from(schema.nemesisAssignments)
      .where(and(eq(schema.nemesisAssignments.userId, userId), eq(schema.nemesisAssignments.isActive, true)))
      .orderBy(desc(schema.nemesisAssignments.assignedAt))
      .limit(1);
    const nemesisId = nemesisRows[0]?.nemesisId;
    if (!nemesisId) throw notFound("No active nemesis to challenge");

    // Check no challenge already active
    const existingRows = await orm
      .select({ id: schema.nemesisChallenges.id })
      .from(schema.nemesisChallenges)
      .where(
        and(
          eq(schema.nemesisChallenges.challengerId, userId),
          gt(schema.nemesisChallenges.expiresAt, sql`NOW()`),
          eq(schema.nemesisChallenges.status, "pending")
        )
      )
      .limit(1);
    if (existingRows.length > 0) {
      throw conflict("You already have a pending challenge", "CHALLENGE_ALREADY_ACTIVE");
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await orm.insert(schema.nemesisChallenges).values({
      challengerId: userId,
      challengedId: nemesisId,
      status: "pending",
      expiresAt,
    });

    // Notify the challenged user (fire-and-forget)
    orm
      .insert(schema.notifications)
      .values({
        userId: nemesisId,
        type: "nemesis_challenge",
        payload: { challenger_id: userId, expires_at: expiresAt.toISOString() },
        isRead: false,
      })
      .catch(() => {});

    return NextResponse.json({
      success: true,
      data: { challengeSent: true, expiresAt: expiresAt.toISOString() },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
