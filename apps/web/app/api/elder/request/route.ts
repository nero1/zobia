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
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

    const orm = await getDb();
    const result = await orm.transaction(async (tx) => {
      // 1. Verify requester's XP level
      const [userRow] = await tx
        .select({ xp_total: schema.users.xpTotal })
        .from(schema.users)
        .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)));
      if (!userRow) throw notFound("User not found");
      if (Number(userRow.xp_total) >= MENTEE_MAX_XP) {
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
      const activeMenteeCount = sql<string>`COUNT(${schema.elderMentorships.id}) FILTER (WHERE ${schema.elderMentorships.endedAt} IS NULL)`;
      const [elder] = await tx
        .select({
          id: schema.users.id,
          prestige_count: sql<number>`COALESCE(${schema.users.prestigeCount}, 0)`,
          last_active_at: schema.users.lastActiveAt,
          mentee_count: activeMenteeCount,
        })
        .from(schema.users)
        .leftJoin(
          schema.elderMentorships,
          and(eq(schema.elderMentorships.elderId, schema.users.id), isNull(schema.elderMentorships.endedAt))
        )
        .where(and(eq(schema.users.id, body.elderId), isNull(schema.users.deletedAt)))
        .groupBy(schema.users.id);
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
      const [existingRequest] = await tx
        .select({ id: schema.elderRequests.id, status: schema.elderRequests.status })
        .from(schema.elderRequests)
        .where(
          and(
            eq(schema.elderRequests.menteeId, userId),
            eq(schema.elderRequests.elderId, body.elderId),
            inArray(schema.elderRequests.status, ["pending", "accepted"])
          )
        )
        .limit(1);
      if (existingRequest) {
        throw conflict(
          "You already have a pending or active request with this elder",
          "REQUEST_ALREADY_EXISTS"
        );
      }

      // 4. Check user doesn't already have an active mentor
      const [activeMentorship] = await tx
        .select({ id: schema.elderMentorships.id })
        .from(schema.elderMentorships)
        .where(and(eq(schema.elderMentorships.menteeId, userId), isNull(schema.elderMentorships.endedAt)))
        .limit(1);
      if (activeMentorship) {
        throw conflict("You already have an active mentor", "ALREADY_HAS_MENTOR");
      }

      // 5. Create request
      const [inserted] = await tx
        .insert(schema.elderRequests)
        .values({
          menteeId: userId,
          elderId: body.elderId,
          message: body.message ?? null,
          status: "pending",
        })
        .returning({ id: schema.elderRequests.id });

      // Queue notification for the elder
      try {
        await tx.insert(schema.notifications).values({
          userId: body.elderId,
          type: "elder_request",
          payload: { requester_id: userId, request_id: inserted.id },
        });
      } catch {
        // Best-effort notification
      }

      return { requestId: inserted.id };
    });

    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
