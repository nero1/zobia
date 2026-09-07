export const dynamic = "force-dynamic";

/**
 * app/api/messages/group/[groupId]/capacity/route.ts
 *
 * POST /api/messages/group/:groupId/capacity
 *
 * Paid capacity upgrade — the group creator spends coins to raise the
 * group's soft CONCURRENT-presence cap above the default, up to the
 * manifest hard ceiling. Mirrors app/api/rooms/[roomId]/capacity/route.ts
 * exactly (same step/cost/hardMax shape, same idempotent-debit pattern).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";
import { resolveGroupConcurrentCap } from "@/lib/groupChats/capacity";
import { debitCoins } from "@/lib/economy/coins";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  steps: z.number().int().min(1).max(10).default(1),
});

interface GroupRow {
  creator_id: string;
  concurrent_cap: number | null;
  is_active: boolean;
  is_deactivated: boolean;
}

interface UserRow {
  is_admin: boolean;
  is_moderator: boolean;
}

/** GET /api/messages/group/:groupId/capacity — current cap + cost for 1 step */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const { groupId } = (await params) as { groupId: string };
    if (!UUID_RE.test(groupId)) throw badRequest("groupId must be a valid UUID");

    const { rows } = await db.query<GroupRow>(
      `SELECT creator_id, concurrent_cap, is_active, is_deactivated FROM group_chats WHERE id = $1`,
      [groupId],
    );
    const group = rows[0];
    if (!group || !group.is_active || group.is_deactivated) throw notFound("Group not found");

    const manifest = await loadManifest();
    const { stepSlots, costCoinsPerStep, hardMax } = manifest.groupChatCapacityUpgrade;
    const currentCap = resolveGroupConcurrentCap(group.concurrent_cap, manifest);
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
        isCreator: group.creator_id === auth.user.sub,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { groupId } = (await params) as { groupId: string };
    if (!UUID_RE.test(groupId)) throw badRequest("groupId must be a valid UUID");

    const { steps } = await validateBody(req, bodySchema);
    const userId = auth.user.sub;

    const { rows } = await db.query<GroupRow>(
      `SELECT creator_id, concurrent_cap, is_active, is_deactivated FROM group_chats WHERE id = $1`,
      [groupId],
    );
    const group = rows[0];
    if (!group || !group.is_active || group.is_deactivated) throw notFound("Group not found");

    const { rows: userRows } = await db.query<UserRow>(
      `SELECT COALESCE(is_admin, FALSE) AS is_admin, COALESCE(is_moderator, FALSE) AS is_moderator
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId],
    );
    const isPrivileged = userRows[0]?.is_admin || userRows[0]?.is_moderator;

    if (group.creator_id !== userId && !isPrivileged) {
      throw forbidden("Only the group creator can upgrade capacity");
    }

    const manifest = await loadManifest();
    const { stepSlots, costCoinsPerStep, hardMax } = manifest.groupChatCapacityUpgrade;

    const currentCap = resolveGroupConcurrentCap(group.concurrent_cap, manifest);
    const newCap = currentCap + stepSlots * steps;
    if (newCap > hardMax) {
      throw badRequest(`Capacity cannot exceed ${hardMax}. Current cap is ${currentCap}.`);
    }
    const cost = costCoinsPerStep * steps;

    try {
      await db.transaction(async (tx) => {
        // Idempotent on the target cap: a retry to the same cap is a no-op.
        await debitCoins(
          userId,
          cost,
          "group_chat_capacity_upgrade",
          `group_capacity:${groupId}:${newCap}`,
          `Group chat capacity upgrade to ${newCap}`,
          { groupId, currentCap, newCap, steps },
          tx,
        );
        await tx.query(
          `UPDATE group_chats SET concurrent_cap = $1, updated_at = NOW() WHERE id = $2`,
          [newCap, groupId],
        );
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "INSUFFICIENT_BALANCE") {
        throw badRequest(`Insufficient coins. This upgrade costs ${cost} Coins.`);
      }
      throw err;
    }

    return NextResponse.json(
      { success: true, data: { concurrentCap: newCap, coinsSpent: cost } },
      { status: 200 },
    );
  } catch (err) {
    return handleApiError(err);
  }
});
