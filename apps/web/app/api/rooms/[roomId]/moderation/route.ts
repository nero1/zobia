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
import { eq, and, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
import { logger } from "@/lib/logger";

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
  const orm = await getDb();
  const [row] = await orm
    .select({ role: schema.roomMembers.role })
    .from(schema.roomMembers)
    .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
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
    const orm = await getDb();
    await orm
      .update(schema.rooms)
      .set({ healthScore: sql`GREATEST(${schema.rooms.healthScore} - ${penalty}, 0)`, updatedAt: sql`NOW()` })
      .where(eq(schema.rooms.id, roomId));
  } catch (err) {
    logger.error({ err: err }, "[rooms/moderation] Health score update failed:");
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
    const orm = await getDb();
    await orm.insert(schema.roomModerationLog).values({
      roomId,
      moderatorId,
      action,
      targetUserId: targetUserId ?? null,
      metadata,
    });
  } catch (err) {
    logger.error({ err: err }, "[rooms/moderation] Audit log write failed:");
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
    const orm = await getDb();

    // Fetch room
    const [room] = await orm
      .select({
        creatorId: schema.rooms.creatorId,
        isActive: schema.rooms.isActive,
        moderationRules: schema.rooms.moderationRules,
      })
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId))
      .limit(1);
    if (!room || !room.isActive) throw notFound("Room not found");

    const isCreator = room.creatorId === callerId;
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

        if (targetUserId === room.creatorId) {
          throw forbidden("The room creator cannot be muted");
        }

        const mutedUntilDate = durationMinutes
          ? new Date(Date.now() + durationMinutes * 60 * 1000)
          : null;
        const mutedUntil = mutedUntilDate ? mutedUntilDate.toISOString() : null;

        await orm
          .update(schema.roomMembers)
          .set({ isMuted: true, mutedUntil: mutedUntilDate, updatedAt: sql`NOW()` })
          .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, targetUserId)));

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

        await orm
          .update(schema.roomMembers)
          .set({ isMuted: false, mutedUntil: null, updatedAt: sql`NOW()` })
          .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, targetUserId)));

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
        const [targetMember] = await orm
          .select({ id: schema.roomMembers.id })
          .from(schema.roomMembers)
          .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, targetUserId)))
          .limit(1);
        if (!targetMember) throw notFound("Target user is not a room member");

        await orm
          .update(schema.roomMembers)
          .set({ role: "co_moderator", updatedAt: sql`NOW()` })
          .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, targetUserId)));

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

        await orm
          .update(schema.roomMembers)
          .set({ role: "member", updatedAt: sql`NOW()` })
          .where(and(
            eq(schema.roomMembers.roomId, roomId),
            eq(schema.roomMembers.userId, targetUserId),
            eq(schema.roomMembers.role, "co_moderator"),
          ));

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
          (room.moderationRules as Record<string, unknown>) ?? {};

        const updatedRules = { ...existingRules, ...body.rules };

        await orm
          .update(schema.rooms)
          .set({ moderationRules: updatedRules, updatedAt: sql`NOW()` })
          .where(eq(schema.rooms.id, roomId));

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

        if (targetUserId === room.creatorId) {
          throw forbidden("The room creator cannot be kicked");
        }
        if (targetUserId === callerId) {
          throw forbidden("Cannot kick yourself");
        }

        const kicked = await orm
          .update(schema.roomMembers)
          .set({ leftAt: sql`NOW()`, updatedAt: sql`NOW()` })
          .where(and(
            eq(schema.roomMembers.roomId, roomId),
            eq(schema.roomMembers.userId, targetUserId),
            sql`${schema.roomMembers.leftAt} IS NULL`,
          ))
          .returning({ userId: schema.roomMembers.userId });
        if (kicked.length === 0) throw notFound("Target user is not an active member of this room");

        // Decrement member_count (guarded to never go below 0)
        await orm
          .update(schema.rooms)
          .set({ memberCount: sql`GREATEST(${schema.rooms.memberCount} - 1, 0)`, updatedAt: sql`NOW()` })
          .where(eq(schema.rooms.id, roomId))
          .catch(() => {});

        // Notify kicked user
        await orm
          .insert(schema.notifications)
          .values({
            userId: targetUserId,
            type: "room_kicked",
            payload: { roomId, reason: reason ?? null },
            isRead: false,
          })
          .catch(() => {});

        await decrementHealthScore(roomId, 3);
        await logModerationAction(roomId, callerId, "kick", targetUserId, { reason });

        return NextResponse.json({ action: "kick", targetUserId }, { status: 200 });
      }

      // -----------------------------------------------------------------------
      case "approve": {
        const { messageId } = body;

        const [msg] = await orm
          .select({
            id: schema.roomMessages.id,
            senderId: schema.roomMessages.senderId,
            content: schema.roomMessages.content,
            isPendingApproval: schema.roomMessages.isPendingApproval,
          })
          .from(schema.roomMessages)
          .where(and(eq(schema.roomMessages.id, messageId), eq(schema.roomMessages.roomId, roomId)))
          .limit(1);
        if (!msg) throw notFound("Message not found in this room");
        if (!msg.isPendingApproval) {
          return NextResponse.json({ action: "approve", messageId, alreadyApproved: true }, { status: 200 });
        }

        await orm.transaction(async (tx) => {
          await tx
            .update(schema.roomMessages)
            .set({ isPendingApproval: false, updatedAt: sql`NOW()` })
            .where(eq(schema.roomMessages.id, messageId));
          await tx
            .update(schema.rooms)
            .set({ totalMessages: sql`${schema.rooms.totalMessages} + 1`, updatedAt: sql`NOW()` })
            .where(eq(schema.rooms.id, roomId));
        });

        // Award XP to the original sender now that the message is approved
        const [senderRow] = await orm
          .select({ plan: schema.users.plan })
          .from(schema.users)
          .where(eq(schema.users.id, msg.senderId))
          .limit(1);
        const senderPlan = (senderRow?.plan ?? 'free') as Plan;

        const [{ count }] = await orm
          .select({ count: sql<string>`COUNT(*)` })
          .from(schema.roomMessages)
          .where(and(
            eq(schema.roomMessages.roomId, roomId),
            eq(schema.roomMessages.senderId, msg.senderId),
            eq(schema.roomMessages.isPendingApproval, false),
            sql`${schema.roomMessages.createdAt}::date = CURRENT_DATE`,
          ));
        const todayMsgCount = parseInt(count ?? '0', 10);

        if (todayMsgCount <= ROOM_MESSAGE_XP_DAILY_CAP) {
          const { finalXp } = calculateFinalXP('send_room_message', { plan: senderPlan, isMessagingAction: true });
          safeAwardXP(msg.senderId, finalXp, "social", "send_message", `msg_${messageId}`)
            .then(() =>
              publishRealtimeEvent(`user:${msg.senderId}`, "reward_earned", { type: "xp", amount: finalXp })
            )
            .catch(() => {});
        }

        await logModerationAction(roomId, callerId, "approve", msg.senderId, { messageId });

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
