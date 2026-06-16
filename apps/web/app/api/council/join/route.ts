export const dynamic = 'force-dynamic';

/**
 * app/api/council/join/route.ts
 *
 * POST /api/council/join
 *
 * Accept a Platform Council invitation and insert the user into
 * platform_council_members. Users are only eligible if they have received
 * a council_invitation notification in the current month cycle.
 *
 * PRD §15: Top 50 users by legacy_score are invited in the last 7 days of
 * each month. They join by accepting the invitation here.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, forbidden, conflict } from "@/lib/api/errors";
import { requireFeatureEnabled } from "@/lib/manifest";

export const POST = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("platformCouncil");
    const userId = auth.user.sub;

    // PRD §15: Council requires Prestige 5 or above
    const { rows: prestigeRows } = await db.query<{ prestige_count: number }>(
      `SELECT COALESCE(prestige_count, 0) AS prestige_count FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    if ((prestigeRows[0]?.prestige_count ?? 0) < 5) {
      throw forbidden("Platform Council membership requires Prestige 5 or above");
    }

    // Verify there is a pending council_invitation notification for this user
    // issued within the last 14 days (covers the invitation + acceptance window)
    const { rows: inviteRows } = await db.query<{ id: string }>(
      `SELECT id FROM notifications
       WHERE user_id = $1
         AND type = 'council_invitation'
         AND created_at >= NOW() - INTERVAL '14 days'
       LIMIT 1`,
      [userId]
    );

    if (!inviteRows[0]) {
      throw forbidden("No pending council invitation found for your account");
    }

    // Check if user is already an active council member
    const { rows: existingRows } = await db.query<{ id: string }>(
      `SELECT id FROM platform_council_members
       WHERE user_id = $1 AND left_at IS NULL
       LIMIT 1`,
      [userId]
    );

    if (existingRows[0]) {
      throw conflict("You are already an active Platform Council member");
    }

    // Get the user's legacy_score
    const { rows: userRows } = await db.query<{
      legacy_score: number;
      username: string;
    }>(
      `SELECT legacy_score, username FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

    if (!userRows[0]) {
      throw forbidden("User not found");
    }

    const cycleMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

    await db.transaction(async (tx) => {
      // Close out any previous council seat for this user (handles re-joiners)
      await tx.query(
        `UPDATE platform_council_members
         SET left_at = NOW()
         WHERE user_id = $1 AND left_at IS NULL`,
        [userId]
      );

      // Insert the new membership — ON CONFLICT prevents duplicates from
      // concurrent requests racing past the outer existence check (IMP-IDMP-01).
      const { rows: insertRows } = await tx.query<{ id: string }>(
        `INSERT INTO platform_council_members
           (user_id, cycle_month, legacy_score, joined_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, cycle_month) DO NOTHING
         RETURNING id`,
        [userId, cycleMonth, userRows[0].legacy_score]
      );
      if (!insertRows[0]) {
        throw conflict("You have already joined the Platform Council this cycle");
      }

      // Mark the invitation notification as read
      await tx.query(
        `UPDATE notifications SET is_read = true
         WHERE user_id = $1 AND type = 'council_invitation'`,
        [userId]
      );
    });

    return NextResponse.json({
      success: true,
      data: {
        cycleMonth,
        legacyScore: userRows[0].legacy_score,
        message: "Welcome to the Platform Council! Your voice shapes Zobia.",
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
