export const dynamic = 'force-dynamic';

/**
 * app/api/rooms/[roomId]/join/route.ts
 *
 * POST /api/rooms/:roomId/join
 *
 * Handles room join logic per room type:
 *  - free_open  : Immediate join, up to 10,000 member cap.
 *  - vip        : Validates active VIP subscription; returns redirect URL if not subscribed.
 *  - drop       : Validates entry fee has been paid; returns redirect URL if not.
 *  - tipping    : Immediate join (free to join, earn via tips).
 *  - classroom  : Validates enrolment record; returns redirect URL if not enrolled.
 *  - guild      : Validates caller is a member of the room's parent guild.
 *
 * XP: Awards 20 XP (explorer track) on first-time join.
 * Increments room member_count on successful join.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import {
  handleApiError,
  notFound,
  forbidden,
  conflict,
  badRequest,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { XP_VALUES } from "@/lib/xp/engine";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";
import { recordWarContribution } from "@/lib/guilds/recordWarContribution";
import { publishRealtimeEvent } from "@/lib/realtime";
import { triggerActivityQuestProgress } from "@/lib/quests/questEngine";
import { advanceNewMemberQuestStep } from "@/lib/quests/newMemberQuestEngine";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface RoomRow {
  id: string;
  type: string;
  creator_id: string;
  is_active: boolean;
  member_count: number;
  max_members: number | null;
  guild_id: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the caller has an active (not left) membership record for this room.
 */
async function isMember(roomId: string, userId: string): Promise<boolean> {
  const orm = await getDb();
  const rows = await orm
    .select({ id: schema.roomMembers.id })
    .from(schema.roomMembers)
    .where(
      and(
        eq(schema.roomMembers.roomId, roomId),
        eq(schema.roomMembers.userId, userId),
        isNull(schema.roomMembers.leftAt)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Insert a room_members record and increment the room member_count.
 * Runs inside a transaction.
 *
 * @param roomId - Target room UUID
 * @param userId - Joining user UUID
 * @param role   - Member role (default "member")
 */
async function addMember(
  roomId: string,
  userId: string,
  role = "member"
): Promise<void> {
  const orm = await getDb();
  await orm.transaction(async (tx) => {
    // If the user previously left (left_at IS NOT NULL), clear it so they rejoin cleanly.
    // If already an active member, the WHERE guard on DO UPDATE makes this a no-op.
    await tx
      .insert(schema.roomMembers)
      .values({ roomId, userId, role, joinedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.roomMembers.roomId, schema.roomMembers.userId],
        set: { leftAt: null, role, joinedAt: new Date() },
        where: sql`${schema.roomMembers.leftAt} IS NOT NULL`,
      });

    // Sync member_count from the actual active-member count to stay accurate
    // across joins, leaves, and rejoins.
    await tx
      .update(schema.rooms)
      .set({
        memberCount: sql`(SELECT COUNT(*) FROM ${schema.roomMembers} WHERE ${schema.roomMembers.roomId} = ${roomId} AND ${schema.roomMembers.leftAt} IS NULL)`,
        updatedAt: new Date(),
      })
      .where(eq(schema.rooms.id, roomId));
  });
}

/**
 * Award first-time room join XP on the explorer track.
 * Returns the XP awarded (0 if already joined or on error).
 */
async function awardJoinXP(roomId: string, userId: string): Promise<number> {
  try {
    const orm = await getDb();
    const rows = await orm
      .select({ id: schema.xpLedger.id })
      .from(schema.xpLedger)
      .where(
        and(
          eq(schema.xpLedger.userId, userId),
          eq(schema.xpLedger.source, "room"),
          eq(schema.xpLedger.referenceId, roomId)
        )
      )
      .limit(1);
    if (rows.length > 0) return 0; // not first time

    const xp = XP_VALUES.join_new_room_first_time; // 20 XP

    // Canonical XP path: ledger insert + users update + leaderboard snapshots,
    // idempotent on (user, 'room', roomId). The previous inline INSERT named
    // a non-existent xp_ledger.multiplier column, so it always threw and
    // first-join XP was never awarded.
    await safeAwardXP(userId, xp, "explorer", "room", roomId);

    return xp;
  } catch (err) {
    logger.error({ err: err }, "[rooms/join] XP award failed (non-fatal):");
    return 0;
  }
}

/**
 * Shared post-join side-effects: XP notification, quest progress, war contribution.
 * Called after membership is confirmed for every room type.
 */
async function firePostJoinSideEffects(roomId: string, userId: string): Promise<void> {
  const joinXp = await awardJoinXP(roomId, userId);
  const orm = await getDb();
  recordWarContribution(userId, "join_room", orm).catch((err) => {
    logger.error({ err: err }, "[rooms:join] war contribution failed");
    });
  if (joinXp > 0) {
    publishRealtimeEvent(`user:${userId}`, "reward_earned", {
      type: "xp",
      amount: joinXp,
    }).catch(() => {});
  }
  triggerActivityQuestProgress(userId, "room_join", orm).catch(() => {});
  void advanceNewMemberQuestStep(orm, userId, "join_room");
}

// ---------------------------------------------------------------------------
// POST /api/rooms/[roomId]/join
// ---------------------------------------------------------------------------

/**
 * Join a room. Access control and payment checks are performed per room type.
 *
 * Response shapes:
 *  - 200 { joined: true }                on success
 *  - 200 { requiresSubscription: true, subscribeUrl: string } for unpaid VIP
 *  - 200 { requiresPayment: true, payUrl: string }            for unpaid Drop
 *  - 200 { requiresEnrolment: true, enrolUrl: string }        for unrolled Classroom
 *  - 403 { error }                        if guild membership missing
 *  - 409 { error }                        if already a member or room full
 *
 * @param req    - Incoming request
 * @param params - Route params containing roomId
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { roomId } = await params as { roomId: string };
    const userId = auth.user.sub;

    // Fetch room
    const orm = await getDb();
    const [room] = await orm
      .select({
        id: schema.rooms.id,
        type: schema.rooms.type,
        creator_id: schema.rooms.creatorId,
        is_active: schema.rooms.isActive,
        member_count: schema.rooms.memberCount,
        max_members: schema.rooms.maxMembers,
        guild_id: schema.rooms.guildId,
      })
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId))
      .limit(1);
    if (!room || !room.is_active) throw notFound("Room not found");

    // Already a member — idempotent: return success so callers don't need to
    // distinguish "just joined" from "already in room" (avoids spurious 409s).
    if (await isMember(roomId, userId)) {
      return NextResponse.json({ joined: true, alreadyMember: true }, { status: 200 });
    }

    // NOTE: room capacity is a *concurrent* (live presence) cap, not a membership
    // cap — membership persists ("you can return"), so it must not block joins.
    // The soft cap is enforced at view time via POST /api/rooms/:id/presence.

    switch (room.type) {
      // -----------------------------------------------------------------------
      case "free_open":
      case "tipping": {
        await addMember(roomId, userId);
        await firePostJoinSideEffects(roomId, userId);
        return NextResponse.json({ joined: true }, { status: 200 });
      }

      // -----------------------------------------------------------------------
      case "vip": {
        // Check for an active VIP subscription for this room
        const subRows = await orm
          .select({ id: schema.roomSubscriptions.id })
          .from(schema.roomSubscriptions)
          .where(
            and(
              eq(schema.roomSubscriptions.roomId, roomId),
              eq(schema.roomSubscriptions.userId, userId),
              eq(schema.roomSubscriptions.status, "active"),
              gt(schema.roomSubscriptions.expiresAt, new Date())
            )
          )
          .limit(1);

        if (subRows.length === 0) {
          return NextResponse.json(
            {
              requiresSubscription: true,
              subscribeUrl: `/api/rooms/${roomId}/subscribe`,
            },
            { status: 200 }
          );
        }

        await addMember(roomId, userId);
        await firePostJoinSideEffects(roomId, userId);
        return NextResponse.json({ joined: true }, { status: 200 });
      }

      // -----------------------------------------------------------------------
      case "drop": {
        // Check entry fee payment
        const payRows = await orm
          .select({ id: schema.payments.id })
          .from(schema.payments)
          .where(
            and(
              eq(schema.payments.userId, userId),
              eq(schema.payments.referenceId, roomId),
              eq(schema.payments.paymentType, "room_entry"),
              eq(schema.payments.status, "completed")
            )
          )
          .limit(1);

        if (payRows.length === 0) {
          return NextResponse.json(
            {
              requiresPayment: true,
              payUrl: `/api/rooms/${roomId}/pay-entry`,
            },
            { status: 200 }
          );
        }

        await addMember(roomId, userId);
        await firePostJoinSideEffects(roomId, userId);
        return NextResponse.json({ joined: true }, { status: 200 });
      }

      // -----------------------------------------------------------------------
      case "classroom": {
        const enrolRows = await orm
          .select({ id: schema.classroomEnrolments.id })
          .from(schema.classroomEnrolments)
          .where(and(eq(schema.classroomEnrolments.roomId, roomId), eq(schema.classroomEnrolments.userId, userId)))
          .limit(1);

        if (enrolRows.length === 0) {
          return NextResponse.json(
            {
              requiresEnrolment: true,
              enrolUrl: `/api/classroom/${roomId}/enroll`,
            },
            { status: 200 }
          );
        }

        await addMember(roomId, userId);
        await firePostJoinSideEffects(roomId, userId);
        return NextResponse.json({ joined: true }, { status: 200 });
      }

      // -----------------------------------------------------------------------
      case "guild": {
        if (!room.guild_id) {
          throw badRequest("Guild room is missing guild association");
        }

        const guildRows = await orm
          .select({ id: schema.guildMembers.id })
          .from(schema.guildMembers)
          .where(and(eq(schema.guildMembers.guildId, room.guild_id), eq(schema.guildMembers.userId, userId)))
          .limit(1);

        if (guildRows.length === 0) {
          throw forbidden("You must be a member of the guild to join this room");
        }

        await addMember(roomId, userId);
        await firePostJoinSideEffects(roomId, userId);
        return NextResponse.json({ joined: true }, { status: 200 });
      }

      // -----------------------------------------------------------------------
      default:
        throw badRequest("Unknown room type");
    }
  } catch (err) {
    return handleApiError(err);
  }
});
