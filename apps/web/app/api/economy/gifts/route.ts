export const dynamic = 'force-dynamic';

/**
 * GET /api/economy/gifts
 *
 * Returns the authenticated user's gift history (sent and/or received).
 *
 * Query params:
 *   type    = "sent" | "received" | "both" (default: "both")
 *   limit   = number (default: 40, max: 100)
 *   offset  = number (default: 0)
 *
 * @module app/api/economy/gifts
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";

interface GiftHistoryRow {
  id: string;
  created_at: string;
  coin_value: number;
  status: string;
  sender_id: string;
  sender_username: string | null;
  sender_display_name: string | null;
  sender_avatar_emoji: string | null;
  recipient_id: string;
  recipient_username: string | null;
  recipient_display_name: string | null;
  recipient_avatar_emoji: string | null;
  gift_name: string;
  gift_emoji: string;
  gift_tier: number;
}

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    const url = new URL(req.url);
    const type = url.searchParams.get("type") ?? "both";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "40"), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0"), 0);

    const whereClause =
      type === "sent"     ? "WHERE g.sender_id = $1" :
      type === "received" ? "WHERE g.recipient_id = $1" :
                            "WHERE (g.sender_id = $1 OR g.recipient_id = $1)";

    const { rows } = await db.query<GiftHistoryRow>(
      `SELECT g.id, g.created_at, g.coin_value, g.status,
              g.sender_id,
              s.username     AS sender_username,
              s.display_name AS sender_display_name,
              s.avatar_emoji AS sender_avatar_emoji,
              g.recipient_id,
              r.username     AS recipient_username,
              r.display_name AS recipient_display_name,
              r.avatar_emoji AS recipient_avatar_emoji,
              gi.name  AS gift_name,
              gi.emoji AS gift_emoji,
              gi.tier  AS gift_tier
       FROM gifts g
       JOIN users s       ON s.id = g.sender_id
       JOIN users r       ON r.id = g.recipient_id
       JOIN gift_items gi ON gi.id = g.gift_item_id
       ${whereClause}
       ORDER BY g.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const gifts = rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      coinValue: row.coin_value,
      status: row.status,
      direction: row.sender_id === userId ? "sent" : "received",
      sender: {
        id: row.sender_id,
        username: row.sender_username,
        displayName: row.sender_display_name,
        avatarEmoji: row.sender_avatar_emoji,
      },
      recipient: {
        id: row.recipient_id,
        username: row.recipient_username,
        displayName: row.recipient_display_name,
        avatarEmoji: row.recipient_avatar_emoji,
      },
      giftItem: {
        name: row.gift_name,
        emoji: row.gift_emoji,
        tier: row.gift_tier,
      },
    }));

    return NextResponse.json({ gifts });
  } catch (err) {
    return handleApiError(err);
  }
});
