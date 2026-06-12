export const dynamic = 'force-dynamic';

/**
 * app/api/elder/request/route.ts
 *
 * POST /api/elder/request
 *
 * Request an elder as a mentee.
 * Available to users below Hustler rank (below 6 000 XP).
 *
 * Body: { elderId, message? }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound, conflict } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Users below this XP can request an elder. */
const MENTEE_MAX_XP = 6_000;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const requestSchema = z.object({
  elderId: z.string().uuid(),
  message: z.string().max(300).optional(),
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

/**
 * Send a mentorship request to an elder.
 * Limited to users below the Hustler rank threshold.
 * Prevents duplicate pending requests.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    const body = await validateBody(req, requestSchema);

    if (userId === body.elderId) {
      throw badRequest("You cannot request yourself as a mentor");
    }

    const result = await db.transaction(async (client) => {
      // 1. Verify requester's XP level
      const userRow = await client.query<{ xp_total: number }>(
        `SELECT xp_total FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      );
      if (!userRow.rows[0]) throw notFound("User not found");
      if (userRow.rows[0].xp_total >= MENTEE_MAX_XP) {
        throw badRequest(
          "You have progressed beyond needing a mentor. Reach Hustler rank to become one!",
          "TOO_ADVANCED_FOR_MENTEE"
        );
      }

      // 2. Verify elder exists and is eligible
      const elderRow = await client.query<{ xp_total: number }>(
        `SELECT xp_total FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [body.elderId]
      );
      if (!elderRow.rows[0]) throw notFound("Elder not found");
      if (elderRow.rows[0].xp_total < MENTEE_MAX_XP) {
        throw badRequest("This user has not reached elder eligibility", "NOT_AN_ELDER");
      }

      // 3. Check for existing pending or accepted request
      const existingRequest = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM elder_requests
         WHERE mentee_id = $1 AND elder_id = $2 AND status IN ('pending', 'accepted')
         LIMIT 1`,
        [userId, body.elderId]
      );
      if (existingRequest.rows[0]) {
        throw conflict(
          "You already have a pending or active request with this elder",
          "REQUEST_ALREADY_EXISTS"
        );
      }

      // 4. Check user doesn't already have an active mentor
      const activeMentorship = await client.query<{ id: string }>(
        `SELECT id FROM elder_mentorships
         WHERE mentee_id = $1 AND ended_at IS NULL LIMIT 1`,
        [userId]
      );
      if (activeMentorship.rows.length > 0) {
        throw conflict("You already have an active mentor", "ALREADY_HAS_MENTOR");
      }

      // 5. Create request
      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO elder_requests (mentee_id, elder_id, message, status, created_at)
         VALUES ($1, $2, $3, 'pending', NOW())
         RETURNING id`,
        [userId, body.elderId, body.message ?? null]
      );

      // Queue notification for the elder
      try {
        await client.query(
          `INSERT INTO notifications (user_id, type, payload, created_at)
           VALUES ($1, 'elder_request', $2, NOW())`,
          [
            body.elderId,
            JSON.stringify({ requester_id: userId, request_id: insertResult.rows[0].id }),
          ]
        );
      } catch {
        // Best-effort notification
      }

      return { requestId: insertResult.rows[0].id };
    });

    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
