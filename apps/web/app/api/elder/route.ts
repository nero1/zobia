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
import { and, desc, eq, gt, gte, isNull, lt, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden, notFound, conflict } from "@/lib/api/errors";
import { ELDER_MIN_PRESTIGE, ELDER_ACTIVITY_DAYS, MAX_MENTEES, MENTEE_MAX_XP } from "@/lib/elder/constants";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const acceptMenteeSchema = z.object({
  requestId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /api/elder
// ---------------------------------------------------------------------------

/**
 * Returns elder eligibility, current mentees, and pending mentorship requests.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    const orm = await getDb();

    const [user] = await orm
      .select({
        prestige_count: schema.users.prestigeCount,
        rank_name: schema.users.rankName,
        last_active_at: schema.users.lastActiveAt,
        xp_total: schema.users.xpTotal,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)));
    if (!user) throw forbidden("User not found");
    const userXpTotal = Number(user.xp_total);

    const recentlyActive =
      user.last_active_at !== null &&
      new Date(user.last_active_at) > new Date(Date.now() - ELDER_ACTIVITY_DAYS * 86400_000);
    const prestigeMet = user.prestige_count >= ELDER_MIN_PRESTIGE;
    // isElder: fully meets the automatic Elder bar (PRD §7 — no separate
    // "application" step). isEligible: prestige threshold met but not yet
    // recently active enough — surfaced so the user knows they're close.
    const isElder = prestigeMet && recentlyActive;
    const isEligible = prestigeMet && !recentlyActive;

    // Current mentees (only meaningful if isElder)
    const menteeRows = await orm
      .select({
        id: schema.elderMentorships.id,
        mentee_id: schema.elderMentorships.menteeId,
        elder_id: schema.elderMentorships.elderId,
        started_at: schema.elderMentorships.startedAt,
        username: schema.users.username,
        display_name: schema.users.displayName,
        avatar_emoji: schema.users.avatarEmoji,
        rank_name: schema.users.rankName,
        xp_total: schema.users.xpTotal,
      })
      .from(schema.elderMentorships)
      .innerJoin(schema.users, eq(schema.users.id, schema.elderMentorships.menteeId))
      .where(and(eq(schema.elderMentorships.elderId, userId), isNull(schema.elderMentorships.endedAt)))
      .orderBy(desc(schema.elderMentorships.startedAt));
    const mentees = menteeRows.map((r) => ({ ...r, xp_total: Number(r.xp_total) }));

    // Pending requests to accept (only meaningful if isElder)
    const pendingRows = await orm
      .select({
        id: schema.elderRequests.id,
        mentee_id: schema.elderRequests.menteeId,
        elder_id: schema.elderRequests.elderId,
        message: schema.elderRequests.message,
        created_at: schema.elderRequests.createdAt,
        mentee_username: schema.users.username,
        mentee_avatar_emoji: schema.users.avatarEmoji,
        mentee_rank_name: schema.users.rankName,
        mentee_xp_total: schema.users.xpTotal,
      })
      .from(schema.elderRequests)
      .innerJoin(schema.users, eq(schema.users.id, schema.elderRequests.menteeId))
      .where(and(eq(schema.elderRequests.elderId, userId), eq(schema.elderRequests.status, "pending")))
      .orderBy(desc(schema.elderRequests.createdAt));
    const pendingRequests = pendingRows.map((r) => ({ ...r, mentee_xp_total: Number(r.mentee_xp_total) }));

    // Mentorship XP earned as an elder (10% bonus on mentees' quest XP)
    const [mentorshipXpRow] = await orm
      .select({ total: sql<string | null>`SUM(${schema.xpLedger.amount})` })
      .from(schema.xpLedger)
      .where(and(eq(schema.xpLedger.userId, userId), eq(schema.xpLedger.source, "mentorship_bonus")));
    const mentorshipXpEarned = Number(mentorshipXpRow?.total ?? 0);

    // Mentee-side state: do they already have a mentor, and can they request one?
    const [activeMentorship] = await orm
      .select({ id: schema.elderMentorships.id })
      .from(schema.elderMentorships)
      .where(and(eq(schema.elderMentorships.menteeId, userId), isNull(schema.elderMentorships.endedAt)))
      .limit(1);
    const hasMentor = !!activeMentorship;

    const [pendingSent] = await orm
      .select({ id: schema.elderRequests.id })
      .from(schema.elderRequests)
      .where(and(eq(schema.elderRequests.menteeId, userId), eq(schema.elderRequests.status, "pending")))
      .limit(1);
    const hasPendingRequest = !!pendingSent;
    const canRequestMentor = userXpTotal < MENTEE_MAX_XP && !hasMentor && !hasPendingRequest;

    // Directory of elders a non-elder can request as a mentor (only fetched
    // when it can actually be used — avoids the extra query for elders).
    let availableElders: {
      id: string;
      username: string;
      displayName: string;
      avatarEmoji: string;
      rankName: string;
      menteeCount: number;
    }[] = [];
    if (canRequestMentor) {
      const activeMenteeCount = sql<string>`COUNT(${schema.elderMentorships.id}) FILTER (WHERE ${schema.elderMentorships.endedAt} IS NULL)`;
      const eldersRows = await orm
        .select({
          id: schema.users.id,
          username: schema.users.username,
          display_name: schema.users.displayName,
          avatar_emoji: schema.users.avatarEmoji,
          rank_name: schema.users.rankName,
          mentee_count: activeMenteeCount,
        })
        .from(schema.users)
        .leftJoin(
          schema.elderMentorships,
          and(eq(schema.elderMentorships.elderId, schema.users.id), isNull(schema.elderMentorships.endedAt))
        )
        .where(
          and(
            ne(schema.users.id, userId),
            isNull(schema.users.deletedAt),
            gte(schema.users.prestigeCount, ELDER_MIN_PRESTIGE),
            gt(schema.users.lastActiveAt, sql`NOW() - (${ELDER_ACTIVITY_DAYS} || ' days')::interval`)
          )
        )
        .groupBy(schema.users.id)
        .having(sql`${activeMenteeCount} < ${MAX_MENTEES}`)
        .orderBy(sql`${activeMenteeCount} ASC`, desc(schema.users.xpTotal))
        .limit(20);
      availableElders = eldersRows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        avatarEmoji: row.avatar_emoji,
        rankName: row.rank_name,
        menteeCount: Number(row.mentee_count),
      }));
    }

    return NextResponse.json({
      success: true,
      data: {
        isElder,
        isEligible,
        eligibilityReason: !prestigeMet
          ? "NOT_ENOUGH_PRESTIGE"
          : !recentlyActive
            ? "INACTIVE"
            : undefined,
        prestigeLevel: user.prestige_count,
        prestigeCount: user.prestige_count,
        rankName: user.rank_name,
        lastActiveAt: user.last_active_at,
        minPrestigeRequired: ELDER_MIN_PRESTIGE,
        maxMentees: MAX_MENTEES,
        currentMenteeCount: mentees.length,
        mentees,
        pendingRequests,
        mentorshipXpEarned,
        hasMentor,
        canRequestMentor,
        availableElders,
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

    const orm = await getDb();
    const result = await orm.transaction(async (tx) => {
      // 1. Verify elder eligibility (prestige >= 3 AND active in past 30 days)
      const [userRow] = await tx
        .select({
          prestige_count: schema.users.prestigeCount,
          last_active_at: schema.users.lastActiveAt,
        })
        .from(schema.users)
        .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
        .for("update");
      if (!userRow) throw forbidden("User not found");
      const isActive =
        userRow.last_active_at !== null &&
        new Date(userRow.last_active_at) >
          new Date(Date.now() - ELDER_ACTIVITY_DAYS * 86400_000);
      if (userRow.prestige_count < ELDER_MIN_PRESTIGE || !isActive) {
        throw forbidden(
          "You must have Prestiged at least 3 times and been active in the past 30 days to become an Elder"
        );
      }

      // 2. Check mentee cap
      const [menteeCountRow] = await tx
        .select({ count: sql<string>`COUNT(*)` })
        .from(schema.elderMentorships)
        .where(and(eq(schema.elderMentorships.elderId, userId), isNull(schema.elderMentorships.endedAt)));
      if (parseInt(menteeCountRow.count) >= MAX_MENTEES) {
        throw badRequest(`Maximum of ${MAX_MENTEES} mentees reached`, "MENTEE_CAP_REACHED");
      }

      // 3. Validate request
      const [request] = await tx
        .select({
          id: schema.elderRequests.id,
          mentee_id: schema.elderRequests.menteeId,
          elder_id: schema.elderRequests.elderId,
          status: schema.elderRequests.status,
        })
        .from(schema.elderRequests)
        .where(eq(schema.elderRequests.id, body.requestId))
        .for("update");
      if (!request) throw notFound("Mentorship request not found");
      if (request.elder_id !== userId) throw forbidden("This request is not for you");
      if (request.status !== "pending") {
        throw conflict("This request has already been processed", "REQUEST_ALREADY_HANDLED");
      }

      // 4. Accept request
      await tx
        .update(schema.elderRequests)
        .set({ status: "accepted", updatedAt: new Date() })
        .where(eq(schema.elderRequests.id, body.requestId));

      // 5. Create mentorship
      const [mentorship] = await tx
        .insert(schema.elderMentorships)
        .values({ elderId: userId, menteeId: request.mentee_id })
        .returning({ id: schema.elderMentorships.id });

      return { mentorshipId: mentorship.id, menteeId: request.mentee_id };
    });

    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
