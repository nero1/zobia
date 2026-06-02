/**
 * app/api/elder/mentees/[userId]/route.ts
 *
 * DELETE /api/elder/mentees/[userId]
 *
 * End an active mentorship. Elder-initiated only.
 * The mentorship record is soft-deleted (ended_at set).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, forbidden, notFound } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

/**
 * End an active mentorship between the calling elder and a mentee.
 */
export const DELETE = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { userId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const elderId = auth.user.sub;
      const menteeId = params.userId;

      const result = await db.query(
        `UPDATE elder_mentorships
         SET ended_at = NOW()
         WHERE elder_id = $1 AND mentee_id = $2 AND ended_at IS NULL`,
        [elderId, menteeId]
      );

      if (result.rowCount === 0) {
        throw notFound("Active mentorship not found");
      }

      return NextResponse.json({
        success: true,
        data: { ended: true, menteeId },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
