export const dynamic = 'force-dynamic';

/**
 * app/api/rooms/[roomId]/rewards/route.ts
 *
 * Room Custom Rewards — a room owner funds/configures ONE active reward at a
 * time; the first `maxClaimants` distinct members who send the owner ANY
 * gift while in this room split a Credits/Stars pool, or each receive a
 * custom-text unlock instruction. See lib/contentTreasury.ts's
 * "Room Custom Rewards" section for the underlying mechanic (shared with
 * Polls/Quizzes' reward pots) and app/api/economy/gifts/send/route.ts for
 * where a claim is actually triggered.
 *
 * GET    — current reward config + progress (any room member may view it)
 * POST   — create/replace the room's reward (owner only)
 * DELETE — deactivate it (owner only)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, forbidden, notFound, badRequest } from "@/lib/api/errors";
import { requireFeatureEnabled, loadManifest } from "@/lib/manifest";
import { getRankForXP } from "@/lib/xp/engine";
import { getRoomReward, fundRoomReward, closeRoomReward } from "@/lib/contentTreasury";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const FundRewardSchema = z.discriminatedUnion("rewardAction", [
  z.object({
    rewardAction: z.enum(["credits", "stars"]),
    title: z.string().trim().min(1).max(80),
    amount: z.number().int().positive(),
    maxClaimants: z.number().int().positive(),
  }),
  z.object({
    rewardAction: z.literal("custom_text"),
    title: z.string().trim().min(1).max(80),
    customInstructions: z.string().trim().min(1).max(2000),
    maxClaimants: z.number().int().positive(),
  }),
]);

// ---------------------------------------------------------------------------
// Shared: load + authorize room
// ---------------------------------------------------------------------------

async function loadRoom(roomId: string): Promise<{ id: string; creator_id: string }> {
  const orm = await getDb();
  const [row] = await orm
    .select({ id: schema.rooms.id, creator_id: schema.rooms.creatorId })
    .from(schema.rooms)
    .where(and(eq(schema.rooms.id, roomId), eq(schema.rooms.isActive, true)))
    .limit(1);
  if (!row) throw notFound("Room not found");
  return row;
}

// ---------------------------------------------------------------------------
// GET /api/rooms/:roomId/rewards
// ---------------------------------------------------------------------------

export const GET = withAuth(
  async (_req: NextRequest, { params }: { params: { roomId: string } }) => {
    try {
      await requireFeatureEnabled("roomCustomRewards");
      const { roomId } = params;
      await loadRoom(roomId);
      const reward = await getRoomReward(roomId);
      return NextResponse.json({ success: true, data: { reward }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/rooms/:roomId/rewards
// ---------------------------------------------------------------------------

export const POST = withAuth(
  async (req: NextRequest, { auth, params }: { auth: { user: { sub: string } }; params: { roomId: string } }) => {
    try {
      await requireFeatureEnabled("roomCustomRewards");
      await requireFeatureEnabled("gifts");
      const userId = auth.user.sub;
      const { roomId } = params;

      const room = await loadRoom(roomId);
      if (room.creator_id !== userId) {
        throw forbidden("Only the room owner can configure its Custom Reward");
      }

      const body = await validateBody(req, FundRewardSchema);

      const manifest = await loadManifest();
      if (body.maxClaimants > manifest.roomCustomRewards.maxClaimantsCap) {
        throw badRequest(
          `Max claimants cannot exceed ${manifest.roomCustomRewards.maxClaimantsCap}.`,
          "ROOM_REWARD_MAX_CLAIMANTS_EXCEEDED"
        );
      }

      const orm = await getDb();
      const [userRow] = await orm
        .select({ xp_total: schema.users.xpTotal })
        .from(schema.users)
        .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
        .limit(1);
      const rankNumber = getRankForXP(Number(userRow?.xp_total ?? 0)).rankNumber;
      if (rankNumber < manifest.roomCustomRewards.minOwnerLevel) {
        throw forbidden(
          `You must reach Level ${manifest.roomCustomRewards.minOwnerLevel} to create a room reward.`,
          "ROOM_REWARD_LEVEL_TOO_LOW"
        );
      }

      const reward = await fundRoomReward({
        ownerId: userId,
        roomId,
        title: body.title,
        maxClaimants: body.maxClaimants,
        rewardAction: body.rewardAction,
        amount: body.rewardAction === "custom_text" ? undefined : body.amount,
        customInstructions: body.rewardAction === "custom_text" ? body.customInstructions : undefined,
      });

      return NextResponse.json({ success: true, data: { reward }, error: null }, { status: 201 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/rooms/:roomId/rewards
// ---------------------------------------------------------------------------

export const DELETE = withAuth(
  async (_req: NextRequest, { auth, params }: { auth: { user: { sub: string } }; params: { roomId: string } }) => {
    try {
      const userId = auth.user.sub;
      const { roomId } = params;

      const room = await loadRoom(roomId);
      if (room.creator_id !== userId) {
        throw forbidden("Only the room owner can deactivate its Custom Reward");
      }

      await closeRoomReward(roomId);

      return NextResponse.json({ success: true, data: { closed: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
