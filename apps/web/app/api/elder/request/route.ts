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
import { MENTEE_MAX_XP, ELDER_MIN_PRESTIGE, ELDER_ACTIVITY_DAYS, MAX_MENTEES } from "@/lib/elder/constants";

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
      // Elder eligibility is prestige + recent activity (see GET /api/elder's
      // availableElders query in app/api/elder/route.ts) — NOT xp_total, which
      // resets to 0 every time a user prestiges (app/api/prestige/route.ts).
      // This previously checked xp_total >= MENTEE_MAX_XP, which meant any
      // elder shown in the availableElders list (freshly prestiged, so
      // xp_total = 0) would always fail this check and 400 on every request.
      const elderRow = await client.query<{
        id: string;
        prestige_count: number;
        last_active_at: string | null;
        mentee_count: string;
      }>(
        `SELECT u.id, COALESCE(u.prestige_count, 0) AS prestige_count, u.last_active_at,
                COUNT(em.id) FILTER (WHERE em.ended_at IS NULL) AS mentee_count
         FROM users u
         LEFT JOIN elder_mentorships em ON em.elder_id = u.id AND em.ended_at IS NULL
         WHERE u.id = $1 AND u.deleted_at IS NULL
         GROUP BY u.id`,
        [body.elderId]
      );
      const elder = elderRow.rows[0];
      if (!elder) throw notFound("Elder not found");
      const elderIsActive =
        !!elder.last_active_at &&
        Date.now() - new Date(elder.last_active_at).getTime() <= ELDER_ACTIVITY_DAYS * 24 * 60 * 60 * 1000;
      if (elder.prestige_count < ELDER_MIN_PRESTIGE || !elderIsActive) {
        throw badRequest("This user has not reached elder eligibility", "NOT_AN_ELDER");
      }
      if (Number(elder.mentee_count) >= MAX_MENTEES) {
        throw conflict("This elder already has the maximum number of mentees", "ELDER_AT_CAPACITY");
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
