export const dynamic = 'force-dynamic';

/**
 * app/api/nemesis/dismiss/route.ts
 *
 * POST /api/nemesis/dismiss
 *
 * Dismisses the current nemesis assignment and triggers an immediate
 * fresh assignment. Users cannot choose their nemesis (PRD §15).
 * Dismissed nemeses are not reassigned to the same user within 4 weeks.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { assignNemesis } from "@/lib/nemesis/nemesisEngine";

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    // Mark current assignment as dismissed
    const { rowCount } = await db.query(
      `UPDATE nemesis_assignments
       SET dismissed_at = NOW()
       WHERE user_id = $1 AND dismissed_at IS NULL`,
      [userId]
    );

    // Assign a fresh nemesis immediately
    const newAssignment = await assignNemesis(userId, db);

    return NextResponse.json({
      success: true,
      data: {
        dismissed: (rowCount ?? 0) > 0,
        newNemesisAssigned: !!newAssignment,
        newNemesisId: newAssignment?.nemesis_id ?? null,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
