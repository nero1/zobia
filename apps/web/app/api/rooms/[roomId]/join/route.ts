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
import { db } from "@/lib/db";
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
import { recordWarContribution } from "@/lib/guilds/recordWarContribution";

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
 * Check whether the caller already has a membership record for this room.
 */
async function isMember(roomId: string, userId: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM room_members WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
    [roomId, userId]
  );
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
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO room_members (room_id, user_id, role, joined_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [roomId, userId, role]
    );

    await tx.query(
      `UPDATE rooms SET member_count = member_count + 1, updated_at = NOW()
       WHERE id = $1`,
      [roomId]
    );
  });
}

/**
 * Award first-time room join XP on the explorer track.
 * Silently swallows errors so a failed XP grant never blocks the join flow.
 *
 * @param roomId - Room UUID
 * @param userId - User UUID
 */
async function awardJoinXP(roomId: string, userId: string): Promise<void> {
  try {
    // Check if the user has ever joined this specific room before
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM xp_ledger
       WHERE user_id = $1 AND source = 'room' AND reference_id = $2 LIMIT 1`,
      [userId, roomId]
    );
    if (rows.length > 0) return; // not first time

    const xp = XP_VALUES.join_new_room_first_time; // 20 XP

    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE users
         SET xp_total = xp_total + $1,
             xp_explorer = xp_explorer + $1,
             updated_at = NOW()
         WHERE id = $2`,
        [xp, userId]
      );

      await tx.query(
        `INSERT INTO xp_ledger
           (user_id, amount, track, source, reference_id, multiplier, base_amount)
         VALUES ($1, $2, 'explorer', 'room', $3, 100, $2)`,
        [userId, xp, roomId]
      );
    });
  } catch (err) {
    console.error("[rooms/join] XP award failed (non-fatal):", err);
  }
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
    const { rows: roomRows } = await db.query<RoomRow>(
      `SELECT id, type, creator_id, is_active, member_count, max_members, guild_id
       FROM rooms WHERE id = $1`,
      [roomId]
    );
    const room = roomRows[0];
    if (!room || !room.is_active) throw notFound("Room not found");

    // Already a member?
    if (await isMember(roomId, userId)) {
      throw conflict("You are already a member of this room");
    }

    // Capacity check (free_open cap = 10,000)
    if (room.max_members !== null && room.member_count >= room.max_members) {
      throw conflict("This room has reached its member limit");
    }

    switch (room.type) {
      // -----------------------------------------------------------------------
      case "free_open":
      case "tipping": {
        await addMember(roomId, userId);
        await awardJoinXP(roomId, userId);
        recordWarContribution(userId, 'join_room', db).catch((err) =>
          console.error('[rooms:join] war contribution failed', err)
        );
        return NextResponse.json({ joined: true }, { status: 200 });
      }

      // -----------------------------------------------------------------------
      case "vip": {
        // Check for an active VIP subscription for this room
        const { rows: subRows } = await db.query<{ id: string }>(
          `SELECT id FROM room_subscriptions
           WHERE room_id = $1
             AND user_id = $2
             AND status = 'active'
             AND expires_at > NOW()
           LIMIT 1`,
          [roomId, userId]
        );

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
        await awardJoinXP(roomId, userId);
        recordWarContribution(userId, 'join_room', db).catch((err) =>
          console.error('[rooms:join] war contribution failed', err)
        );
        return NextResponse.json({ joined: true }, { status: 200 });
      }

      // -----------------------------------------------------------------------
      case "drop": {
        // Check entry fee payment
        const { rows: payRows } = await db.query<{ id: string }>(
          `SELECT id FROM payments
           WHERE user_id = $1
             AND reference_id = $2
             AND payment_type = 'room_entry'
             AND status = 'completed'
           LIMIT 1`,
          [userId, roomId]
        );

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
        await awardJoinXP(roomId, userId);
        recordWarContribution(userId, 'join_room', db).catch((err) =>
          console.error('[rooms:join] war contribution failed', err)
        );
        return NextResponse.json({ joined: true }, { status: 200 });
      }

      // -----------------------------------------------------------------------
      case "classroom": {
        const { rows: enrolRows } = await db.query<{ id: string }>(
          `SELECT id FROM classroom_enrolments
           WHERE room_id = $1 AND user_id = $2
           LIMIT 1`,
          [roomId, userId]
        );

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
        await awardJoinXP(roomId, userId);
        recordWarContribution(userId, 'join_room', db).catch((err) =>
          console.error('[rooms:join] war contribution failed', err)
        );
        return NextResponse.json({ joined: true }, { status: 200 });
      }

      // -----------------------------------------------------------------------
      case "guild": {
        if (!room.guild_id) {
          throw badRequest("Guild room is missing guild association");
        }

        const { rows: guildRows } = await db.query<{ id: string }>(
          `SELECT id FROM guild_members
           WHERE guild_id = $1 AND user_id = $2
           LIMIT 1`,
          [room.guild_id, userId]
        );

        if (guildRows.length === 0) {
          throw forbidden("You must be a member of the guild to join this room");
        }

        await addMember(roomId, userId);
        await awardJoinXP(roomId, userId);
        recordWarContribution(userId, 'join_room', db).catch((err) =>
          console.error('[rooms:join] war contribution failed', err)
        );
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
