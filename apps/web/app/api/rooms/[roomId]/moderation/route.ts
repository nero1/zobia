export const dynamic = 'force-dynamic';

/**
 * app/api/rooms/[roomId]/moderation/route.ts
 *
 * Room moderation actions.
 *
 * POST /api/rooms/:roomId/moderation
 *
 * Dispatches moderation actions based on the `action` field in the request body:
 *
 *  - mute          : Mute a member for a duration (or indefinitely).
 *  - unmute        : Lift a mute.
 *  - co_mod        : Appoint a member as co-moderator.
 *  - remove_co_mod : Remove co-moderator status.
 *  - update_rules  : Update auto-mod rules (link blocking, new member posting).
 *
 * All actions require caller to be the room creator or a co-moderator.
 * Appointing/removing co-moderators is creator-only.
 * Every moderation action triggers a health score update.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import {
  handleApiError,
  notFound,
  forbidden,
  badRequest,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";
import { ROOM_MESSAGE_XP_DAILY_CAP, calculateFinalXP } from "@/lib/xp/engine";
import { publishRealtimeEvent } from "@/lib/realtime";
import type { Plan } from "@zobia/types";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const muteSchema = z.object({
  action: z.literal("mute"),
  targetUserId: z.string().uuid(),
  /** Duration in minutes. Omit for indefinite mute. */
  durationMinutes: z.number().int().min(1).max(43200).optional(),
  reason: z.string().max(500).optional(),
});

const unmuteSchema = z.object({
  action: z.literal("unmute"),
  targetUserId: z.string().uuid(),
});

const coModSchema = z.object({
  action: z.literal("co_mod"),
  targetUserId: z.string().uuid(),
});

const removeCoModSchema = z.object({
  action: z.literal("remove_co_mod"),
  targetUserId: z.string().uuid(),
});

const updateRulesSchema = z.object({
  action: z.literal("update_rules"),
  rules: z.object({
    /** Block link sharing by non-admins in the room. */
    blockLinks: z.boolean().optional(),
    /** Block phone numbers. */
    blockPhones: z.boolean().optional(),
    /** Prevent new members from posting for N hours after joining. */
    newMemberPostHoldHours: z.number().int().min(0).max(72).optional(),
    /** Require manual approval before new messages appear. */
    requireApproval: z.boolean().optional(),
    /** Restrict allowed message types (e.g. ["text","sticker"]). */
    allowedMessageTypes: z.array(z.string()).optional(),
    /** Require slow-mode gap between messages (seconds). */
    slowModeSeconds: z.number().int().min(0).max(3600).optional(),
  }),
});

const kickSchema = z.object({
  action: z.literal("kick"),
  targetUserId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

const approveSchema = z.object({
  action: z.literal("approve"),
  messageId: z.string().uuid("messageId must be a valid UUID"),
});

const moderationSchema = z.discriminatedUnion("action", [
  muteSchema,
  unmuteSchema,
  coModSchema,
  removeCoModSchema,
  updateRulesSchema,
  kickSchema,
  approveSchema,
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch caller's role in a room. Returns null if not a member.
 */
async function getCallerRole(
  roomId: string,
  userId: string
): Promise<string | null> {
  const { rows } = await db.query<{ role: string }>(
    `SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
    [roomId, userId]
  );
  return rows[0]?.role ?? null;
}

/**
 * Decrement room health score by `penalty` points after a moderation action.
 * Health score is bounded at 0.
 *
 * @param roomId  - Room UUID
 * @param penalty - Points to subtract (default 1)
 */
async function decrementHealthScore(
  roomId: string,
  penalty = 1
): Promise<void> {
  try {
    await db.query(
      `UPDATE rooms
       SET health_score = GREATEST(health_score - $2, 0), updated_at = NOW()
       WHERE id = $1`,
      [roomId, penalty]
    );
  } catch (err) {
    console.error("[rooms/moderation] Health score update failed:", err);
  }
}

/**
 * Log a moderation action to the room_moderation_log table.
 *
 * @param roomId       - Room UUID
 * @param moderatorId  - Moderator UUID
 * @param action       - Action name (mute, unmute, co_mod, etc.)
 * @param targetUserId - Target user UUID if applicable
 * @param metadata     - Extra data (duration, reason, rules)
 */
async function logModerationAction(
  roomId: string,
  moderatorId: string,
  action: string,
  targetUserId: string | null,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO room_moderation_log
         (room_id, moderator_id, action, target_user_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [roomId, moderatorId, action, targetUserId ?? null, JSON.stringify(metadata)]
    );
  } catch (err) {
    console.error("[rooms/moderation] Audit log write failed:", err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/rooms/[roomId]/moderation
// ---------------------------------------------------------------------------

/**
 * Dispatch a room moderation action.
 *
 * @param req    - Incoming request with action payload
 * @param params - Route params containing roomId
 * @returns 200 with result summary or 204 for no-content operations
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { roomId } = await params as { roomId: string };
    const callerId = auth.user.sub;

    // Fetch room
    const { rows: roomRows } = await db.query<{
      creator_id: string;
      is_active: boolean;
      moderation_rules: unknown;
    }>(
      `SELECT creator_id, is_active, moderation_rules FROM rooms WHERE id = $1`,
      [roomId]
    );
    const room = roomRows[0];
    if (!room || !room.is_active) throw notFound("Room not found");

    const isCreator = room.creator_id === callerId;
    const callerRole = await getCallerRole(roomId, callerId);

    // Must be creator or co-mod to perform any moderation
    if (!isCreator && callerRole !== "co_moderator") {
      throw forbidden("Only the creator or a co-moderator can perform moderation actions");
    }

    const body = await validateBody(req, moderationSchema);

    // -------------------------------------------------------------------------
    switch (body.action) {
      // -----------------------------------------------------------------------
      case "mute": {
        const { targetUserId, durationMinutes, reason } = body;

        if (targetUserId === room.creator_id) {
          throw forbidden("The room creator cannot be muted");
        }

        const mutedUntil = durationMinutes
          ? new Date(Date.now() + durationMinutes * 60 * 1000).toISOString()
          : null;

        await db.query(
          `UPDATE room_members
           SET is_muted = TRUE, muted_until = $3, updated_at = NOW()
           WHERE room_id = $1 AND user_id = $2`,
          [roomId, targetUserId, mutedUntil]
        );

        await decrementHealthScore(roomId, 2);
        await logModerationAction(roomId, callerId, "mute", targetUserId, {
          durationMinutes,
          reason,
          mutedUntil,
        });

        return NextResponse.json(
          { action: "mute", targetUserId, mutedUntil },
          { status: 200 }
        );
      }

      // -----------------------------------------------------------------------
      case "unmute": {
        const { targetUserId } = body;

        await db.query(
          `UPDATE room_members
           SET is_muted = FALSE, muted_until = NULL, updated_at = NOW()
           WHERE room_id = $1 AND user_id = $2`,
          [roomId, targetUserId]
        );

        await logModerationAction(roomId, callerId, "unmute", targetUserId, {});

        return NextResponse.json({ action: "unmute", targetUserId }, { status: 200 });
      }

      // -----------------------------------------------------------------------
      case "co_mod": {
        // Creator-only action
        if (!isCreator) {
          throw forbidden("Only the room creator can appoint co-moderators");
        }

        const { targetUserId } = body;

        // Verify target is a member
        const { rows: memberRows } = await db.query<{ id: string }>(
          `SELECT id FROM room_members WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
          [roomId, targetUserId]
        );
        if (memberRows.length === 0) throw notFound("Target user is not a room member");

        await db.query(
          `UPDATE room_members SET role = 'co_moderator', updated_at = NOW()
           WHERE room_id = $1 AND user_id = $2`,
          [roomId, targetUserId]
        );

        await logModerationAction(roomId, callerId, "co_mod", targetUserId, {});

        return NextResponse.json(
          { action: "co_mod", targetUserId },
          { status: 200 }
        );
      }

      // -----------------------------------------------------------------------
      case "remove_co_mod": {
        if (!isCreator) {
          throw forbidden("Only the room creator can remove co-moderators");
        }

        const { targetUserId } = body;

        await db.query(
          `UPDATE room_members SET role = 'member', updated_at = NOW()
           WHERE room_id = $1 AND user_id = $2 AND role = 'co_moderator'`,
          [roomId, targetUserId]
        );

        await logModerationAction(roomId, callerId, "remove_co_mod", targetUserId, {});

        return NextResponse.json(
          { action: "remove_co_mod", targetUserId },
          { status: 200 }
        );
      }

      // -----------------------------------------------------------------------
      case "update_rules": {
        // Creator-only action for auto-mod rule changes
        if (!isCreator) {
          throw forbidden("Only the room creator can update auto-mod rules");
        }

        const existingRules =
          (room.moderation_rules as Record<string, unknown>) ?? {};

        const updatedRules = { ...existingRules, ...body.rules };

        await db.query(
          `UPDATE rooms
           SET moderation_rules = $2, updated_at = NOW()
           WHERE id = $1`,
          [roomId, JSON.stringify(updatedRules)]
        );

        await logModerationAction(roomId, callerId, "update_rules", null, {
          rules: body.rules,
        });

        return NextResponse.json(
          { action: "update_rules", rules: updatedRules },
          { status: 200 }
        );
      }

      // -----------------------------------------------------------------------
      case "kick": {
        const { targetUserId, reason } = body;

        if (targetUserId === room.creator_id) {
          throw forbidden("The room creator cannot be kicked");
        }
        if (targetUserId === callerId) {
          throw forbidden("Cannot kick yourself");
        }

        const { rowCount } = await db.query(
          `UPDATE room_members
           SET left_at = NOW(), updated_at = NOW()
           WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL`,
          [roomId, targetUserId]
        );
        if (!rowCount) throw notFound("Target user is not an active member of this room");

        // Decrement member_count (guarded to never go below 0)
        await db.query(
          `UPDATE rooms SET member_count = GREATEST(member_count - 1, 0), updated_at = NOW() WHERE id = $1`,
          [roomId]
        ).catch(() => {});

        // Notify kicked user
        await db.query(
          `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
           VALUES ($1, 'room_kicked', $2, false, NOW())`,
          [targetUserId, JSON.stringify({ roomId, reason: reason ?? null })]
        ).catch(() => {});

        await decrementHealthScore(roomId, 3);
        await logModerationAction(roomId, callerId, "kick", targetUserId, { reason });

        return NextResponse.json({ action: "kick", targetUserId }, { status: 200 });
      }

      // -----------------------------------------------------------------------
      case "approve": {
        const { messageId } = body;

        const { rows: msgRows } = await db.query<{
          id: string;
          sender_id: string;
          content: string;
          is_pending_approval: boolean;
        }>(
          `SELECT id, sender_id, content, is_pending_approval
           FROM room_messages
           WHERE id = $1 AND room_id = $2 LIMIT 1`,
          [messageId, roomId]
        );
        const msg = msgRows[0];
        if (!msg) throw notFound("Message not found in this room");
        if (!msg.is_pending_approval) {
          return NextResponse.json({ action: "approve", messageId, alreadyApproved: true }, { status: 200 });
        }

        await db.transaction(async (tx) => {
          await tx.query(
            `UPDATE room_messages
             SET is_pending_approval = FALSE, updated_at = NOW()
             WHERE id = $1`,
            [messageId]
          );
          await tx.query(
            `UPDATE rooms SET total_messages = total_messages + 1, updated_at = NOW() WHERE id = $1`,
            [roomId]
          );
        });

        // Award XP to the original sender now that the message is approved
        const { rows: senderRows } = await db.query<{ plan: string }>(
          `SELECT COALESCE(plan, 'free') AS plan FROM users WHERE id = $1 LIMIT 1`,
          [msg.sender_id]
        );
        const senderPlan = (senderRows[0]?.plan ?? 'free') as Plan;

        const { rows: countRows } = await db.query<{ cnt: string }>(
          `SELECT COUNT(*) AS cnt
           FROM room_messages
           WHERE room_id = $1 AND sender_id = $2
             AND is_pending_approval = FALSE
             AND created_at::date = CURRENT_DATE`,
          [roomId, msg.sender_id]
        );
        const todayMsgCount = parseInt(countRows[0]?.cnt ?? '0', 10);

        if (todayMsgCount <= ROOM_MESSAGE_XP_DAILY_CAP) {
          const { finalXp } = calculateFinalXP('send_room_message', { plan: senderPlan, isMessagingAction: true });
          safeAwardXP(msg.sender_id, finalXp, "social", "send_message", `msg_${messageId}`)
            .then(() =>
              publishRealtimeEvent(`user:${msg.sender_id}`, "reward_earned", { type: "xp", amount: finalXp })
            )
            .catch(() => {});
        }

        await logModerationAction(roomId, callerId, "approve", msg.sender_id, { messageId });

        return NextResponse.json({ action: "approve", messageId }, { status: 200 });
      }

      // -----------------------------------------------------------------------
      default:
        throw badRequest("Unknown moderation action");
    }
  } catch (err) {
    return handleApiError(err);
  }
});
