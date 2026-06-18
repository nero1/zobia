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
import { db } from "@/lib/db";
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
}

/** GET /api/rooms/:roomId/capacity — returns current cap and cost for 1 upgrade step */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const { roomId } = (await params) as { roomId: string };
    if (!UUID_RE.test(roomId)) throw badRequest("roomId must be a valid UUID");

    const { rows } = await db.query<RoomRow>(
      `SELECT creator_id, type, max_members, is_active FROM rooms WHERE id = $1`,
      [roomId],
    );
    const room = rows[0];
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

    const { rows } = await db.query<RoomRow>(
      `SELECT creator_id, type, max_members, is_active FROM rooms WHERE id = $1`,
      [roomId],
    );
    const room = rows[0];
    if (!room || !room.is_active) throw notFound("Room not found");
    if (room.creator_id !== userId) {
      throw forbidden("Only the room creator can upgrade capacity");
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
      await db.transaction(async (tx) => {
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
        await tx.query(
          `UPDATE rooms SET max_members = $1, updated_at = NOW() WHERE id = $2`,
          [newCap, roomId],
        );
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
