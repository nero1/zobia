/**
 * app/api/nemesis/route.ts
 *
 * Nemesis system endpoints.
 *
 * GET  /api/nemesis
 *   - Returns the calling user's current nemesis assignment with XP comparison.
 *
 * POST /api/nemesis/dismiss
 *   - Dismisses the current nemesis and triggers a fresh assignment.
 *
 * POST /api/nemesis/challenge
 *   - Sends a 7-day XP sprint challenge notification to the nemesis.
 *
 * All sub-actions (/dismiss, /challenge) are handled via URL path inspection.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, conflict, forbidden } from "@/lib/api/errors";
import { assignNemesis, compareNemesisProgress } from "@/lib/nemesis/nemesisEngine";
import { getTrackLevelForXP } from "@/lib/xp/engine";

// ---------------------------------------------------------------------------
// Feature gate constants
// ---------------------------------------------------------------------------

const MIN_COMPETITOR_LEVEL_FOR_CHALLENGE = 40;

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface NemesisRow {
  user_id: string;
  nemesis_id: string;
  assigned_at: string;
  dismissed_at: string | null;
  nemesis_username: string;
  nemesis_display_name: string;
  nemesis_avatar_emoji: string;
  nemesis_rank_name: string;
  nemesis_xp_total: number;
  nemesis_city: string | null;
}

// ---------------------------------------------------------------------------
// GET /api/nemesis
// ---------------------------------------------------------------------------

/**
 * Returns the user's current nemesis with XP delta comparison.
 */
export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const { rows } = await db.query<NemesisRow>(
      `SELECT na.user_id, na.nemesis_id, na.assigned_at, na.dismissed_at,
              u.username AS nemesis_username,
              u.display_name AS nemesis_display_name,
              u.avatar_emoji AS nemesis_avatar_emoji,
              u.rank_name AS nemesis_rank_name,
              u.xp_total AS nemesis_xp_total,
              u.city AS nemesis_city
       FROM nemesis_assignments na
       JOIN users u ON u.id = na.nemesis_id
       WHERE na.user_id = $1 AND na.dismissed_at IS NULL
       ORDER BY na.assigned_at DESC
       LIMIT 1`,
      [userId]
    );

    if (!rows[0]) {
      // No nemesis — try to assign one
      const newAssignment = await assignNemesis(userId, db);
      if (!newAssignment) {
        return NextResponse.json({
          success: true,
          data: { nemesis: null },
          error: null,
        });
      }

      // Refetch with profile
      const refreshedRows = await db.query<NemesisRow>(
        `SELECT na.user_id, na.nemesis_id, na.assigned_at, na.dismissed_at,
                u.username AS nemesis_username,
                u.display_name AS nemesis_display_name,
                u.avatar_emoji AS nemesis_avatar_emoji,
                u.rank_name AS nemesis_rank_name,
                u.xp_total AS nemesis_xp_total,
                u.city AS nemesis_city
         FROM nemesis_assignments na
         JOIN users u ON u.id = na.nemesis_id
         WHERE na.user_id = $1 AND na.dismissed_at IS NULL
         ORDER BY na.assigned_at DESC
         LIMIT 1`,
        [userId]
      );
      if (!refreshedRows.rows[0]) {
        return NextResponse.json({ success: true, data: { nemesis: null }, error: null });
      }
      rows.push(...refreshedRows.rows);
    }

    const nemesis = rows[0];

    // XP comparison
    const comparison = await compareNemesisProgress(userId, nemesis.nemesis_id, "main", db);

    return NextResponse.json({
      success: true,
      data: {
        nemesis: {
          userId: nemesis.nemesis_id,
          username: nemesis.nemesis_username,
          displayName: nemesis.nemesis_display_name,
          avatarEmoji: nemesis.nemesis_avatar_emoji,
          rankName: nemesis.nemesis_rank_name,
          xpTotal: nemesis.nemesis_xp_total,
          city: nemesis.nemesis_city,
          assignedAt: nemesis.assigned_at,
        },
        comparison: {
          userXP: comparison.userXP,
          nemesisXP: comparison.nemesisXP,
          delta: comparison.delta,
          userIsAhead: comparison.userIsAhead,
        },
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/nemesis/dismiss  &  POST /api/nemesis/challenge
// ---------------------------------------------------------------------------

/**
 * Dismiss the current nemesis (generates a new one),
 * or send a 7-day XP sprint challenge to the nemesis.
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    const action = new URL(req.url).pathname.split("/").at(-1); // 'dismiss' or 'challenge'

    if (action === "dismiss") {
      // Dismiss current assignment
      const updateResult = await db.query(
        `UPDATE nemesis_assignments SET dismissed_at = NOW()
         WHERE user_id = $1 AND dismissed_at IS NULL`,
        [userId]
      );

      // Assign a new nemesis
      const newAssignment = await assignNemesis(userId, db);

      return NextResponse.json({
        success: true,
        data: {
          dismissed: updateResult.rowCount > 0,
          newNemesisAssigned: !!newAssignment,
          newNemesisId: newAssignment?.nemesis_id ?? null,
        },
        error: null,
      });
    }

    if (action === "challenge") {
      // Get current nemesis
      const nemesisResult = await db.query<{ nemesis_id: string }>(
        `SELECT nemesis_id FROM nemesis_assignments
         WHERE user_id = $1 AND dismissed_at IS NULL
         ORDER BY assigned_at DESC LIMIT 1`,
        [userId]
      );
      const nemesisId = nemesisResult.rows[0]?.nemesis_id;
      if (!nemesisId) throw notFound("No active nemesis to challenge");

      // Enforce Competitor Track Level 40 gate (PRD §7)
      const { rows: xpRows } = await db.query<{ xp_competitor: number }>(
        `SELECT xp_competitor FROM users WHERE id = $1`,
        [userId]
      );
      const competitorXP = xpRows[0]?.xp_competitor ?? 0;
      const competitorTrackInfo = getTrackLevelForXP("competitor", competitorXP);
      if (competitorTrackInfo.level < MIN_COMPETITOR_LEVEL_FOR_CHALLENGE) {
        throw forbidden(
          `You must reach Competitor Track Level ${MIN_COMPETITOR_LEVEL_FOR_CHALLENGE} to challenge users to XP sprints.`
        );
      }

      // Check no challenge already pending
      const existingChallenge = await db.query<{ id: string }>(
        `SELECT id FROM nemesis_challenges
         WHERE challenger_id = $1 AND expires_at > NOW() AND status = 'pending'
         LIMIT 1`,
        [userId]
      );
      if (existingChallenge.rows.length > 0) {
        throw conflict("You already have a pending challenge", "CHALLENGE_ALREADY_ACTIVE");
      }

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await db.query(
        `INSERT INTO nemesis_challenges (challenger_id, challenged_id, status, expires_at, created_at)
         VALUES ($1, $2, 'pending', $3, NOW())`,
        [userId, nemesisId, expiresAt]
      );

      // Queue notification (best-effort — don't fail if notifications table doesn't exist)
      try {
        await db.query(
          `INSERT INTO user_notifications (user_id, type, payload, created_at)
           VALUES ($1, 'nemesis_challenge', $2, NOW())`,
          [
            nemesisId,
            JSON.stringify({ challenger_id: userId, expires_at: expiresAt }),
          ]
        );
      } catch {
        // Notification table may not exist yet — log but don't fail
      }

      return NextResponse.json({
        success: true,
        data: { challengeSent: true, expiresAt },
        error: null,
      });
    }

    return NextResponse.json(
      { success: false, data: null, error: { code: "UNKNOWN_ACTION", message: "Unknown action" } },
      { status: 400 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
