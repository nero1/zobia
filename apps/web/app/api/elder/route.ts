export const dynamic = 'force-dynamic';

/**
 * app/api/elder/route.ts
 *
 * Elder system endpoints.
 *
 * GET  /api/elder
 *   - Returns elder eligibility status and current mentee list.
 *   - Elders are users at Hustler rank or above.
 *
 * POST /api/elder/mentees
 *   - Accept a pending mentorship request from a prospective mentee.
 *
 * DELETE /api/elder/mentees/[userId]
 *   - End an active mentorship (elder-initiated).
 *   - Handled in /api/elder/mentees/[userId]/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden, notFound, conflict } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum prestige count to be eligible as an elder (PRD §7). */
const ELDER_MIN_PRESTIGE = 3;

/** Elder must have been active within this many days. */
const ELDER_ACTIVITY_DAYS = 30;

/** Maximum concurrent mentees per elder. */
const MAX_MENTEES = 5;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const acceptMenteeSchema = z.object({
  requestId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface MenteeRow {
  id: string;
  mentee_id: string;
  elder_id: string;
  started_at: string;
  username: string;
  display_name: string;
  avatar_emoji: string;
  rank_name: string;
  xp_total: number;
}

interface PendingRequestRow {
  id: string;
  mentee_id: string;
  elder_id: string;
  message: string | null;
  created_at: string;
  mentee_username: string;
  mentee_avatar_emoji: string;
  mentee_rank_name: string;
  mentee_xp_total: number;
}

// ---------------------------------------------------------------------------
// GET /api/elder
// ---------------------------------------------------------------------------

/**
 * Returns elder eligibility, current mentees, and pending mentorship requests.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;

    const userResult = await db.query<{
      prestige_count: number;
      rank_name: string;
      last_active_at: string | null;
    }>(
      `SELECT prestige_count, rank_name, last_active_at
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    const user = userResult.rows[0];
    if (!user) throw forbidden("User not found");

    const recentlyActive =
      user.last_active_at !== null &&
      new Date(user.last_active_at) > new Date(Date.now() - ELDER_ACTIVITY_DAYS * 86400_000);
    const eligible = user.prestige_count >= ELDER_MIN_PRESTIGE && recentlyActive;

    // Current mentees
    const menteeResult = await db.query<MenteeRow>(
      `SELECT em.id, em.mentee_id, em.elder_id, em.started_at,
              u.username, u.display_name, u.avatar_emoji, u.rank_name, u.xp_total
       FROM elder_mentorships em
       JOIN users u ON u.id = em.mentee_id
       WHERE em.elder_id = $1 AND em.ended_at IS NULL
       ORDER BY em.started_at DESC`,
      [userId]
    );

    // Pending requests
    const pendingResult = await db.query<PendingRequestRow>(
      `SELECT er.id, er.mentee_id, er.elder_id, er.message, er.created_at,
              u.username AS mentee_username,
              u.avatar_emoji AS mentee_avatar_emoji,
              u.rank_name AS mentee_rank_name,
              u.xp_total AS mentee_xp_total
       FROM elder_requests er
       JOIN users u ON u.id = er.mentee_id
       WHERE er.elder_id = $1 AND er.status = 'pending'
       ORDER BY er.created_at DESC`,
      [userId]
    );

    return NextResponse.json({
      success: true,
      data: {
        eligible,
        prestigeCount: user.prestige_count,
        rankName: user.rank_name,
        minPrestigeRequired: ELDER_MIN_PRESTIGE,
        maxMentees: MAX_MENTEES,
        currentMenteeCount: menteeResult.rows.length,
        mentees: menteeResult.rows,
        pendingRequests: pendingResult.rows,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/elder/mentees
// ---------------------------------------------------------------------------

/**
 * Accept a pending mentorship request.
 * The elder must be eligible (Hustler rank or above) and below the MAX_MENTEES cap.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    const body = await validateBody(req, acceptMenteeSchema);

    const result = await db.transaction(async (client) => {
      // 1. Verify elder eligibility (prestige >= 3 AND active in past 30 days)
      const userRow = await client.query<{
        prestige_count: number;
        last_active_at: string | null;
      }>(
        `SELECT prestige_count, last_active_at FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [userId]
      );
      if (!userRow.rows[0]) throw forbidden("User not found");
      const isActive =
        userRow.rows[0].last_active_at !== null &&
        new Date(userRow.rows[0].last_active_at) >
          new Date(Date.now() - ELDER_ACTIVITY_DAYS * 86400_000);
      if (userRow.rows[0].prestige_count < ELDER_MIN_PRESTIGE || !isActive) {
        throw forbidden(
          "You must have Prestiged at least 3 times and been active in the past 30 days to become an Elder"
        );
      }

      // 2. Check mentee cap
      const menteeCountResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM elder_mentorships
         WHERE elder_id = $1 AND ended_at IS NULL`,
        [userId]
      );
      if (parseInt(menteeCountResult.rows[0].count) >= MAX_MENTEES) {
        throw badRequest(`Maximum of ${MAX_MENTEES} mentees reached`, "MENTEE_CAP_REACHED");
      }

      // 3. Validate request
      const requestRow = await client.query<{
        id: string;
        mentee_id: string;
        elder_id: string;
        status: string;
      }>(
        `SELECT id, mentee_id, elder_id, status
         FROM elder_requests WHERE id = $1 FOR UPDATE`,
        [body.requestId]
      );
      const request = requestRow.rows[0];
      if (!request) throw notFound("Mentorship request not found");
      if (request.elder_id !== userId) throw forbidden("This request is not for you");
      if (request.status !== "pending") {
        throw conflict("This request has already been processed", "REQUEST_ALREADY_HANDLED");
      }

      // 4. Accept request
      await client.query(
        `UPDATE elder_requests SET status = 'accepted', updated_at = NOW() WHERE id = $1`,
        [body.requestId]
      );

      // 5. Create mentorship
      const mentorshipResult = await client.query<{ id: string }>(
        `INSERT INTO elder_mentorships (elder_id, mentee_id, started_at)
         VALUES ($1, $2, NOW())
         RETURNING id`,
        [userId, request.mentee_id]
      );

      return { mentorshipId: mentorshipResult.rows[0].id, menteeId: request.mentee_id };
    });

    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
