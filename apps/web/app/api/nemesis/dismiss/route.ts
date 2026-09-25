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
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { assignNemesis } from "@/lib/nemesis/nemesisEngine";

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    const orm = await getDb();

    // Mark current assignment as dismissed and inactive so it is never returned by GET/challenge
    const updateResult = await orm
      .update(schema.nemesisAssignments)
      .set({ dismissedAt: sql`NOW()`, isActive: false })
      .where(and(eq(schema.nemesisAssignments.userId, userId), eq(schema.nemesisAssignments.isActive, true)));
    const rowCount = updateResult.rowCount;

    // Assign a fresh nemesis immediately
    const newAssignment = await assignNemesis(userId, orm);

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
