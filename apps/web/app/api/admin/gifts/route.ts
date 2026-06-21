export const dynamic = 'force-dynamic';

/**
 * app/api/admin/gifts/route.ts
 *
 * GET  /api/admin/gifts  — list all gift items (active + retired), cursor-paginated
 * POST /api/admin/gifts  — create a new gift item
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

interface GiftItemRow {
  id: string;
  name: string;
  emoji: string;
  coin_cost: number;
  tier: number;
  animation_url: string | null;
  spectacle_threshold_coins: number | null;
  is_active: boolean;
  created_at: string;
}

const createGiftSchema = z.object({
  name: z.string().min(1).max(100),
  emoji: z.string().min(1).max(10),
  coinCost: z.number().int().positive(),
  tier: z.number().int().min(1).max(5),
  animationUrl: z.string().url().nullable().optional(),
  spectacleThresholdCoins: z.number().int().positive().nullable().optional(),
});

export const GET = withAdminAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);
    const cursor = searchParams.get("cursor");
    const showRetired = searchParams.get("retired") === "true";

    const params: (string | number | boolean)[] = [];
    let idx = 1;
    const conditions: string[] = [];

    if (!showRetired) {
      conditions.push(`is_active = TRUE`);
    }

    if (cursor) {
      const [ts, id] = cursor.split("__");
      conditions.push(`(created_at, id) < ($${idx++}::timestamptz, $${idx++}::uuid)`);
      params.push(ts, id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit + 1);

    const { rows } = await db.query<GiftItemRow>(
      `SELECT id, name, emoji, coin_cost, tier, animation_url,
              spectacle_threshold_coins, is_active, created_at
       FROM gift_items
       ${where}
       ORDER BY tier ASC, coin_cost ASC, created_at DESC, id DESC
       LIMIT $${idx}`,
      params
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last
      ? `${last.created_at}__${last.id}`
      : null;

    return NextResponse.json({
      success: true,
      data: {
        gifts: items.map((r) => ({
          id: r.id,
          name: r.name,
          emoji: r.emoji,
          coinCost: r.coin_cost,
          tier: r.tier,
          animationUrl: r.animation_url,
          spectacleThresholdCoins: r.spectacle_threshold_coins,
          isActive: r.is_active,
          createdAt: r.created_at,
        })),
        nextCursor,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest) => {
  try {
    const body = await validateBody(req, createGiftSchema);

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO gift_items (name, emoji, coin_cost, tier, animation_url, spectacle_threshold_coins, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING id`,
      [
        body.name,
        body.emoji,
        body.coinCost,
        body.tier,
        body.animationUrl ?? null,
        body.spectacleThresholdCoins ?? null,
      ]
    );

    return NextResponse.json({ success: true, data: { id: rows[0].id }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
