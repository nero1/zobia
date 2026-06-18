export const dynamic = 'force-dynamic';

/**
 * app/api/nemesis/route.ts
 *
 * GET /api/nemesis
 *   Returns the calling user's current nemesis assignment with full data
 *   shaped for the Expo client: me, nemesis, recentActivity, sprintActive.
 *
 * Sub-action routes live in dedicated files (Next.js App Router):
 *   POST /api/nemesis/challenge → app/api/nemesis/challenge/route.ts
 *   POST /api/nemesis/dismiss  → app/api/nemesis/dismiss/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, conflict, forbidden } from "@/lib/api/errors";
import { assignNemesis, compareNemesisProgress } from "@/lib/nemesis/nemesisEngine";
import { getTrackLevelForXP } from "@/lib/xp/engine";
import { loadManifest } from "@/lib/manifest";

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
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    const manifest = await loadManifest();
    if (!manifest.features.nemesisSystem) {
      return NextResponse.json({ nemesis: null, me: null, recentActivity: [], sprintActive: false });
    }

    const { rows } = await db.query<NemesisRow>(
      `SELECT na.user_id, na.nemesis_user_id AS nemesis_id, na.assigned_at,
              u.username AS nemesis_username,
              u.display_name AS nemesis_display_name,
              u.avatar_emoji AS nemesis_avatar_emoji,
              u.rank_name AS nemesis_rank_name,
              u.xp_total AS nemesis_xp_total,
              u.city AS nemesis_city
       FROM nemesis_assignments na
       JOIN users u ON u.id = na.nemesis_user_id
       WHERE na.user_id = $1 AND na.is_active = true
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

    const nemesisRow = rows[0];

    // Fetch the calling user's own profile data
    const { rows: myRows } = await db.query<{
      display_name: string;
      avatar_emoji: string;
      xp_total: number;
    }>(
      `SELECT display_name, avatar_emoji, COALESCE(xp_total, 0) AS xp_total
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    const me = myRows[0];

    // XP comparison
    const comparison = await compareNemesisProgress(userId, nemesisRow.nemesis_id, "main", db);

    // Recent XP activity for both parties (last 20 events combined)
    const { rows: activityRows } = await db.query<{
      id: string;
      user_id: string;
      action: string;
      xp_net: number;
      created_at: string;
    }>(
      `(SELECT id, user_id, action, xp_net, created_at
        FROM xp_ledger
        WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC LIMIT 10)
       UNION ALL
       (SELECT id, user_id, action, xp_net, created_at
        FROM xp_ledger
        WHERE user_id = $2 AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC LIMIT 10)
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId, nemesisRow.nemesis_id]
    );

    const recentActivity = activityRows.map((a) => ({
      id: a.id,
      userId: a.user_id,
      description: (a.action ?? "unknown activity").replace(/_/g, " "),
      xpEarned: a.xp_net,
      createdAt: a.created_at,
    }));

    // Check if there is an active sprint challenge between these two users
    const { rows: sprintRows } = await db.query<{ id: string; expires_at: string }>(
      `SELECT id, expires_at FROM nemesis_challenges
       WHERE ((challenger_id = $1 AND challenged_id = $2)
           OR (challenger_id = $2 AND challenged_id = $1))
         AND status = 'pending'
         AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [userId, nemesisRow.nemesis_id]
    );
    const activeSprint = sprintRows[0] ?? null;

    return NextResponse.json({
      me: {
        userId,
        displayName: me?.display_name ?? "",
        avatarEmoji: me?.avatar_emoji ?? "😊",
        xp: comparison.userXP,
      },
      nemesis: {
        userId: nemesisRow.nemesis_id,
        displayName: nemesisRow.nemesis_display_name,
        avatarEmoji: nemesisRow.nemesis_avatar_emoji,
        xp: comparison.nemesisXP,
      },
      recentActivity,
      sprintActive: activeSprint !== null,
      sprintEndsAt: activeSprint?.expires_at ?? null,
      // Legacy fields for web client compatibility
      comparison: {
        userXP: comparison.userXP,
        nemesisXP: comparison.nemesisXP,
        delta: comparison.delta,
        userIsAhead: comparison.userIsAhead,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/nemesis  — redirects to sub-routes for clarity
// NOTE: actual POST actions live at:
//   /api/nemesis/challenge  (challenge/route.ts)
//   /api/nemesis/dismiss    (dismiss/route.ts)
// This stub is kept so any stale client calling POST /api/nemesis with an
// action body still gets a helpful error rather than a 405.
// ---------------------------------------------------------------------------

/**
 * @deprecated Use POST /api/nemesis/challenge or POST /api/nemesis/dismiss.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    const manifest = await loadManifest();
    if (!manifest.features.nemesisSystem) {
      return NextResponse.json({ success: false, data: null, error: { code: "FEATURE_DISABLED", message: "Nemesis system is currently disabled" } }, { status: 503 });
    }
    // Read action from request body — stale clients may POST here instead of
    // the dedicated /api/nemesis/challenge or /api/nemesis/dismiss sub-routes.
    const body = await req.json().catch(() => ({})) as { action?: string };
    const action = body.action;

    if (action === "dismiss") {
      // Dismiss current assignment
      const updateResult = await db.query(
        `UPDATE nemesis_assignments SET is_active = false
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      );

      // Assign a new nemesis
      const newAssignment = await assignNemesis(userId, db);

      return NextResponse.json({
        success: true,
        data: {
          dismissed: (updateResult.rowCount ?? 0) > 0,
          newNemesisAssigned: !!newAssignment,
          newNemesisId: newAssignment?.nemesis_id ?? null,
        },
        error: null,
      });
    }

    if (action === "challenge") {
      // Get current nemesis
      const nemesisResult = await db.query<{ nemesis_user_id: string }>(
        `SELECT nemesis_user_id FROM nemesis_assignments
         WHERE user_id = $1 AND is_active = true
         ORDER BY assigned_at DESC LIMIT 1`,
        [userId]
      );
      const nemesisId = nemesisResult.rows[0]?.nemesis_user_id;
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
          `You must reach Competitor Track Level ${MIN_COMPETITOR_LEVEL_FOR_CHALLENGE} to challenge users to XP sprints.`,
          "LEVEL_GATE"
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
          `INSERT INTO notifications (user_id, type, payload, created_at)
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
