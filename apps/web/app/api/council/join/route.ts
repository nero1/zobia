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

    // Also check user_notifications table (cron uses a different table)
    const { rows: userNotifRows } = await db.query<{ id: string }>(
      `SELECT id FROM user_notifications
       WHERE user_id = $1
         AND type = 'council_invitation'
         AND created_at >= NOW() - INTERVAL '14 days'
       LIMIT 1`,
      [userId]
    );

    if (!inviteRows[0] && !userNotifRows[0]) {
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

    // Close out any previous council seat for this user (handles re-joiners)
    await db.query(
      `UPDATE platform_council_members
       SET left_at = NOW()
       WHERE user_id = $1 AND left_at IS NULL`,
      [userId]
    );

    // Insert the new membership
    await db.query(
      `INSERT INTO platform_council_members
         (user_id, cycle_month, legacy_score, joined_at)
       VALUES ($1, $2, $3, NOW())`,
      [userId, cycleMonth, userRows[0].legacy_score]
    );

    // Mark the invitation notification as read
    await db.query(
      `UPDATE notifications SET is_read = true
       WHERE user_id = $1 AND type = 'council_invitation'`,
      [userId]
    ).catch(() => {});
    await db.query(
      `UPDATE user_notifications SET is_read = true
       WHERE user_id = $1 AND type = 'council_invitation'`,
      [userId]
    ).catch(() => {});

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
