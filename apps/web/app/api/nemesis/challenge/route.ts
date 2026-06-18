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
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, conflict, forbidden } from "@/lib/api/errors";
import { getTrackLevelForXP } from "@/lib/xp/engine";

const MIN_COMPETITOR_LEVEL_FOR_CHALLENGE = 40;

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;

    // Enforce Competitor Track Level 40 gate (PRD §7)
    const { rows: xpRows } = await db.query<{ xp_competitor: number }>(
      `SELECT xp_competitor FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    if (!xpRows[0]) throw notFound("User not found");

    const competitorXP = xpRows[0].xp_competitor ?? 0;
    const competitorTrackInfo = getTrackLevelForXP("competitor", competitorXP);
    if (competitorTrackInfo.level < MIN_COMPETITOR_LEVEL_FOR_CHALLENGE) {
      throw forbidden(
        `You must reach Competitor Track Level ${MIN_COMPETITOR_LEVEL_FOR_CHALLENGE} to challenge users to XP sprints.`,
        "LEVEL_GATE"
      );
    }

    // Get current active nemesis
    const { rows: nemesisRows } = await db.query<{ nemesis_id: string }>(
      `SELECT nemesis_user_id AS nemesis_id FROM nemesis_assignments
       WHERE user_id = $1 AND is_active = true
       ORDER BY assigned_at DESC LIMIT 1`,
      [userId]
    );
    const nemesisId = nemesisRows[0]?.nemesis_id;
    if (!nemesisId) throw notFound("No active nemesis to challenge");

    // Check no challenge already active
    const { rows: existingRows } = await db.query<{ id: string }>(
      `SELECT id FROM nemesis_challenges
       WHERE challenger_id = $1 AND expires_at > NOW() AND status = 'pending'
       LIMIT 1`,
      [userId]
    );
    if (existingRows.length > 0) {
      throw conflict("You already have a pending challenge", "CHALLENGE_ALREADY_ACTIVE");
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await db.query(
      `INSERT INTO nemesis_challenges (challenger_id, challenged_id, status, expires_at, created_at)
       VALUES ($1, $2, 'pending', $3, NOW())`,
      [userId, nemesisId, expiresAt]
    );

    // Notify the challenged user (fire-and-forget)
    db.query(
      `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
       VALUES ($1, 'nemesis_challenge', $2, false, NOW())`,
      [nemesisId, JSON.stringify({ challenger_id: userId, expires_at: expiresAt })]
    ).catch(() => {});

    return NextResponse.json({
      success: true,
      data: { challengeSent: true, expiresAt },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
