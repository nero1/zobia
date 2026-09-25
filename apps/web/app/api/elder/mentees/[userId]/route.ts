export const dynamic = 'force-dynamic';

/**
 * app/api/elder/mentees/[userId]/route.ts
 *
 * DELETE /api/elder/mentees/[userId]
 *
 * End an active mentorship. Elder-initiated only.
 * The mentorship record is soft-deleted (ended_at set).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";

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

      const orm = await getDb();
      const updated = await orm
        .update(schema.elderMentorships)
        .set({ endedAt: new Date() })
        .where(
          and(
            eq(schema.elderMentorships.elderId, elderId),
            eq(schema.elderMentorships.menteeId, menteeId),
            isNull(schema.elderMentorships.endedAt)
          )
        )
        .returning({ id: schema.elderMentorships.id });

      if (updated.length === 0) {
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
