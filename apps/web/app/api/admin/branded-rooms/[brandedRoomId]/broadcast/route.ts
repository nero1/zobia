export const dynamic = 'force-dynamic';

/**
 * app/api/admin/branded-rooms/[brandedRoomId]/broadcast/route.ts
 *
 * POST /api/admin/branded-rooms/[brandedRoomId]/broadcast
 *
 * Send a brand-sponsored broadcast message to all members of the branded room
 * (or to all followers of the room's creator if targeting is set to 'creator_followers').
 *
 * PRD §17 — Branded Rooms: brands may send sponsored broadcast messages.
 * Cost is deducted from the branded room's sponsor_budget_coins.
 *
 * Body:
 *  {
 *    message: string            — Broadcast message text (max 500 chars)
 *    targetType?: 'room_members' | 'creator_followers'  — default: room_members
 *    coinBonusPerRecipient?: number  — Extra coins to award per recipient (default: 0)
 *  }
 *
 * Response: { recipientCount, totalCoinCost, remainingBudget }
 *
 * Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const broadcastSchema = z.object({
  message: z.string().min(1).max(500),
  targetType: z.enum(["room_members", "creator_followers"]).default("room_members"),
  coinBonusPerRecipient: z.number().int().min(0).max(100).default(0),
});

// ---------------------------------------------------------------------------
// POST /api/admin/branded-rooms/[brandedRoomId]/broadcast
// ---------------------------------------------------------------------------

export const POST = withAdminAuth(async (
  req: NextRequest,
  { params, auth }: { params: { brandedRoomId: string }; auth: { user: { sub: string } } }
) => {
  try {
    const { brandedRoomId } = params;
    const body = await validateBody(req, broadcastSchema);

    const orm = await getDb();

    // Fetch branded room
    const [branded] = await orm
      .select({
        id: schema.brandedRooms.id,
        room_id: schema.brandedRooms.roomId,
        brand_name: schema.brandedRooms.brandName,
        sponsor_budget_coins: schema.brandedRooms.sponsorBudgetCoins,
        join_bonus_coins: schema.brandedRooms.joinBonusCoins,
        is_active: schema.brandedRooms.isActive,
        ends_at: schema.brandedRooms.endsAt,
      })
      .from(schema.brandedRooms)
      .where(eq(schema.brandedRooms.id, brandedRoomId))
      .limit(1);
    if (!branded) throw notFound("Branded room not found");
    if (!branded.is_active) throw badRequest("Branded room is not active");
    if (branded.ends_at && branded.ends_at < new Date()) {
      throw badRequest("Branded room sponsorship has ended");
    }
    const sponsorBudgetCoins = Number(branded.sponsor_budget_coins);

    // Resolve target user IDs
    let targetUserIds: string[] = [];

    if (body.targetType === "room_members" && branded.room_id) {
      const rows = await orm
        .select({ user_id: schema.roomMembers.userId })
        .from(schema.roomMembers)
        .where(eq(schema.roomMembers.roomId, branded.room_id));
      targetUserIds = rows.map((r) => r.user_id);
    } else if (body.targetType === "creator_followers" && branded.room_id) {
      // NOTE: the previous raw SQL joined on `f.followed_id`, a column that
      // has never existed on `follows` (the DB/schema column is
      // `following_id` — see migration 0001_consolidated_schema.sql) — every
      // call with targetType='creator_followers' would have failed with a
      // Postgres "column does not exist" error. Fixed to use following_id.
      const rows = await orm
        .select({ user_id: schema.follows.followerId })
        .from(schema.follows)
        .innerJoin(schema.rooms, eq(schema.rooms.id, branded.room_id))
        .where(eq(schema.follows.followingId, schema.rooms.creatorId));
      targetUserIds = rows.map((r) => r.user_id);
    }

    if (targetUserIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: { recipientCount: 0, totalCoinCost: 0, remainingBudget: sponsorBudgetCoins },
        error: null,
      });
    }

    const totalCoinCost = (body.coinBonusPerRecipient ?? 0) * targetUserIds.length;

    // Check budget
    if (totalCoinCost > 0 && sponsorBudgetCoins < totalCoinCost) {
      throw badRequest(
        `Insufficient sponsor budget. Need ${totalCoinCost} coins, have ${sponsorBudgetCoins}.`
      );
    }

    // Send broadcast notifications and optionally award coins
    await orm.transaction(async (tx) => {
      // Insert notifications in bulk
      for (const userId of targetUserIds) {
        await tx.insert(schema.notifications).values({
          userId,
          type: "brand_broadcast",
          payload: {
            brandName: branded.brand_name,
            message: body.message,
            brandedRoomId,
            coinBonus: body.coinBonusPerRecipient,
          },
          isRead: false,
        });

        // Award coin bonus if specified
        if (body.coinBonusPerRecipient > 0) {
          const [updatedUser] = await tx
            .update(schema.users)
            .set({
              coinBalance: sql`${schema.users.coinBalance} + ${body.coinBonusPerRecipient}`,
              updatedAt: new Date(),
            })
            .where(eq(schema.users.id, userId))
            .returning({ coinBalance: schema.users.coinBalance });

          if (updatedUser) {
            const balanceAfter = updatedUser.coinBalance;
            const balanceBefore = balanceAfter - BigInt(body.coinBonusPerRecipient);
            await tx.insert(schema.coinLedger).values({
              userId,
              amount: BigInt(body.coinBonusPerRecipient),
              balanceBefore,
              balanceAfter,
              transactionType: "brand_broadcast_bonus",
              referenceId: brandedRoomId,
              description: `Brand broadcast bonus: ${branded.brand_name}`,
            });
          }
        }
      }

      // Deduct from sponsor budget
      if (totalCoinCost > 0) {
        await tx
          .update(schema.brandedRooms)
          .set({ sponsorBudgetCoins: sql`${schema.brandedRooms.sponsorBudgetCoins} - ${totalCoinCost}` })
          .where(eq(schema.brandedRooms.id, brandedRoomId));
      }
    });

    const remainingBudget = sponsorBudgetCoins - totalCoinCost;

    return NextResponse.json({
      success: true,
      data: {
        recipientCount: targetUserIds.length,
        totalCoinCost,
        remainingBudget,
        targetType: body.targetType,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
