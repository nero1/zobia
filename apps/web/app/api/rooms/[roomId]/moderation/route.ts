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
    newMemberPostingHoldHours: z.number().int().min(0).max(72).optional(),
    /** Require manual approval for new messages (slow mode). */
    slowModeSeconds: z.number().int().min(0).max(3600).optional(),
  }),
});

const moderationSchema = z.discriminatedUnion("action", [
  muteSchema,
  unmuteSchema,
  coModSchema,
  removeCoModSchema,
  updateRulesSchema,
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
      default:
        throw badRequest("Unknown moderation action");
    }
  } catch (err) {
    return handleApiError(err);
  }
});
