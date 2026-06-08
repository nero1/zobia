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
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { db } from "@/lib/db";

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

    // Fetch branded room
    const { rows: brandedRoomRows } = await db.query<{
      id: string;
      room_id: string | null;
      brand_name: string;
      sponsor_budget_coins: number;
      join_bonus_coins: number;
      is_active: boolean;
      ends_at: string | null;
    }>(
      `SELECT id, room_id, brand_name, sponsor_budget_coins, join_bonus_coins, is_active, ends_at
       FROM branded_rooms WHERE id = $1 LIMIT 1`,
      [brandedRoomId]
    );
    const branded = brandedRoomRows[0];
    if (!branded) throw notFound("Branded room not found");
    if (!branded.is_active) throw badRequest("Branded room is not active");
    if (branded.ends_at && new Date(branded.ends_at) < new Date()) {
      throw badRequest("Branded room sponsorship has ended");
    }

    // Resolve target user IDs
    let targetUserIds: string[] = [];

    if (body.targetType === "room_members" && branded.room_id) {
      const { rows } = await db.query<{ user_id: string }>(
        `SELECT user_id FROM room_members WHERE room_id = $1`,
        [branded.room_id]
      );
      targetUserIds = rows.map((r) => r.user_id);
    } else if (body.targetType === "creator_followers" && branded.room_id) {
      const { rows } = await db.query<{ user_id: string }>(
        `SELECT f.follower_id AS user_id
         FROM follows f
         JOIN rooms r ON r.id = $1
         WHERE f.followed_id = r.creator_id`,
        [branded.room_id]
      );
      targetUserIds = rows.map((r) => r.user_id);
    }

    if (targetUserIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: { recipientCount: 0, totalCoinCost: 0, remainingBudget: branded.sponsor_budget_coins },
        error: null,
      });
    }

    const totalCoinCost = (body.coinBonusPerRecipient ?? 0) * targetUserIds.length;

    // Check budget
    if (totalCoinCost > 0 && branded.sponsor_budget_coins < totalCoinCost) {
      throw badRequest(
        `Insufficient sponsor budget. Need ${totalCoinCost} coins, have ${branded.sponsor_budget_coins}.`
      );
    }

    // Send broadcast notifications and optionally award coins
    await db.transaction(async (tx) => {
      // Insert notifications in bulk
      for (const userId of targetUserIds) {
        await tx.query(
          `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
           VALUES ($1, 'brand_broadcast', $2::jsonb, FALSE, NOW())`,
          [
            userId,
            JSON.stringify({
              brandName: branded.brand_name,
              message: body.message,
              brandedRoomId,
              coinBonus: body.coinBonusPerRecipient,
            }),
          ]
        );

        // Award coin bonus if specified
        if (body.coinBonusPerRecipient > 0) {
          await tx.query(
            `UPDATE users SET coin_balance = coin_balance + $1, updated_at = NOW() WHERE id = $2`,
            [body.coinBonusPerRecipient, userId]
          );
          await tx.query(
            `INSERT INTO coin_ledger
               (user_id, amount, balance_before, balance_after, transaction_type, reference_id, description, created_at)
             SELECT $1, $2, coin_balance - $2, coin_balance, 'brand_broadcast_bonus', $3,
                    $4, NOW()
             FROM users WHERE id = $1`,
            [userId, body.coinBonusPerRecipient, brandedRoomId, `Brand broadcast bonus: ${branded.brand_name}`]
          );
        }
      }

      // Deduct from sponsor budget
      if (totalCoinCost > 0) {
        await tx.query(
          `UPDATE branded_rooms
           SET sponsor_budget_coins = sponsor_budget_coins - $1
           WHERE id = $2`,
          [totalCoinCost, brandedRoomId]
        );
      }
    });

    const remainingBudget = branded.sponsor_budget_coins - totalCoinCost;

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
