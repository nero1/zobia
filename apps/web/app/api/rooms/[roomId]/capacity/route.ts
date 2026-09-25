export const dynamic = "force-dynamic";

/**
 * app/api/rooms/[roomId]/capacity/route.ts
 *
 * POST /api/rooms/:roomId/capacity
 *
 * Paid capacity upgrade — the room creator spends coins to raise their room's
 * soft participant cap (`max_members`) above the room-type default, up to the
 * manifest hard ceiling. Each "step" adds a fixed number of slots for a fixed
 * coin cost (both admin-tunable via the manifest).
 *
 * Atomic: the coin debit and the cap bump happen in one transaction, and the
 * debit is idempotent (keyed on the target cap) so a retried request can never
 * double-charge.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/drizzle";
import { and, eq, isNull } from "drizzle-orm";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";
import { resolveRoomCap } from "@/lib/rooms/capacity";
import { debitCoins } from "@/lib/economy/coins";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  steps: z.number().int().min(1).max(10).default(1),
});

interface RoomRow {
  creator_id: string;
  type: string;
  max_members: number | null;
  is_active: boolean;
  monetization_disabled: boolean;
}

interface UserRow {
  is_admin: boolean;
  is_moderator: boolean;
}

/** GET /api/rooms/:roomId/capacity — returns current cap and cost for 1 upgrade step */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const { roomId } = (await params) as { roomId: string };
    if (!UUID_RE.test(roomId)) throw badRequest("roomId must be a valid UUID");

    const orm = await getDb();
    const [room] = await orm
      .select({
        creator_id: schema.rooms.creatorId,
        type: schema.rooms.type,
        max_members: schema.rooms.maxMembers,
        is_active: schema.rooms.isActive,
        monetization_disabled: schema.rooms.monetizationDisabled,
      })
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId))
      .limit(1);
    if (!room || !room.is_active) throw notFound("Room not found");

    const manifest = await loadManifest();
    const { stepSlots, costCoinsPerStep, hardMax } = manifest.roomCapacityUpgrade;
    const currentCap = resolveRoomCap(room.type, room.max_members, manifest);
    const newCap = currentCap + stepSlots;
    const atMax = newCap > hardMax;

    return NextResponse.json({
      success: true,
      data: {
        currentCap,
        stepSlots,
        costCoinsPerStep,
        hardMax,
        atMax,
        isCreator: room.creator_id === auth.user.sub,
        monetizationDisabled: room.monetization_disabled,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { roomId } = (await params) as { roomId: string };
    if (!UUID_RE.test(roomId)) throw badRequest("roomId must be a valid UUID");

    const { steps } = await validateBody(req, bodySchema);
    const userId = auth.user.sub;

    const orm = await getDb();
    const [room] = await orm
      .select({
        creator_id: schema.rooms.creatorId,
        type: schema.rooms.type,
        max_members: schema.rooms.maxMembers,
        is_active: schema.rooms.isActive,
        monetization_disabled: schema.rooms.monetizationDisabled,
      })
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId))
      .limit(1);
    if (!room || !room.is_active) throw notFound("Room not found");

    const [userRole] = await orm
      .select({ is_admin: schema.users.isAdmin, is_moderator: schema.users.isModerator })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    const isPrivileged = userRole?.is_admin || userRole?.is_moderator;

    if (room.creator_id !== userId && !isPrivileged) {
      throw forbidden("Only the room creator can upgrade capacity");
    }

    if (room.monetization_disabled && !isPrivileged) {
      throw forbidden("Monetization has been disabled for this room");
    }

    const manifest = await loadManifest();
    const { stepSlots, costCoinsPerStep, hardMax } = manifest.roomCapacityUpgrade;

    const currentCap = resolveRoomCap(room.type, room.max_members, manifest);
    const newCap = currentCap + stepSlots * steps;
    if (newCap > hardMax) {
      throw badRequest(
        `Capacity cannot exceed ${hardMax}. Current cap is ${currentCap}.`,
      );
    }
    const cost = costCoinsPerStep * steps;

    try {
      await orm.transaction(async (tx) => {
        // Idempotent on the target cap: a retry to the same cap is a no-op.
        await debitCoins(
          userId,
          cost,
          "room_capacity_upgrade",
          `capacity:${roomId}:${newCap}`,
          `Room capacity upgrade to ${newCap}`,
          { roomId, currentCap, newCap, steps },
          tx,
        );
        await tx
          .update(schema.rooms)
          .set({ maxMembers: newCap, updatedAt: new Date() })
          .where(eq(schema.rooms.id, roomId));
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "INSUFFICIENT_BALANCE") {
        throw badRequest(`Insufficient coins. This upgrade costs ${cost} Coins.`);
      }
      throw err;
    }

    return NextResponse.json(
      { success: true, data: { maxMembers: newCap, coinsSpent: cost } },
      { status: 200 },
    );
  } catch (err) {
    return handleApiError(err);
  }
});
