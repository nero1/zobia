export const dynamic = 'force-dynamic';

/**
 * app/api/admin/gifts/[id]/route.ts
 *
 * PATCH  /api/admin/gifts/:id  — update a gift item
 * DELETE /api/admin/gifts/:id  — retire (soft-delete) a gift item
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";

const updateGiftSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  emoji: z.string().min(1).max(10).optional(),
  coinCost: z.number().int().positive().optional(),
  tier: z.number().int().min(1).max(5).optional(),
  animationUrl: z.string().url().nullable().optional(),
  spectacleThresholdCoins: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = withAdminAuth(async (req: NextRequest, ctx) => {
  try {
    const params = await ctx.params as { id?: string };
    const id = params?.id;
    if (!id) throw notFound("Gift item not found");

    const body = await validateBody(req, updateGiftSchema);

    const sets: string[] = [];
    const values: (string | number | boolean | null)[] = [];
    let i = 1;

    if (body.name !== undefined)                      { sets.push(`name = $${i++}`);                        values.push(body.name); }
    if (body.emoji !== undefined)                     { sets.push(`emoji = $${i++}`);                       values.push(body.emoji); }
    if (body.coinCost !== undefined)                  { sets.push(`coin_cost = $${i++}`);                   values.push(body.coinCost); }
    if (body.tier !== undefined)                      { sets.push(`tier = $${i++}`);                        values.push(body.tier); }
    if (body.animationUrl !== undefined)              { sets.push(`animation_url = $${i++}`);               values.push(body.animationUrl ?? null); }
    if (body.spectacleThresholdCoins !== undefined)   { sets.push(`spectacle_threshold_coins = $${i++}`);   values.push(body.spectacleThresholdCoins ?? null); }
    if (body.isActive !== undefined)                  { sets.push(`is_active = $${i++}`);                   values.push(body.isActive); }

    if (sets.length === 0) {
      return NextResponse.json({ success: true, data: null, error: null });
    }

    values.push(id);
    const { rowCount } = await db.query(
      `UPDATE gift_items SET ${sets.join(", ")} WHERE id = $${i}`,
      values
    );

    if (!rowCount) throw notFound("Gift item not found");

    return NextResponse.json({ success: true, data: null, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAdminAuth(async (_req: NextRequest, ctx) => {
  try {
    const params = await ctx.params as { id?: string };
    const id = params?.id;
    if (!id) throw notFound("Gift item not found");

    const { rowCount } = await db.query(
      `UPDATE gift_items SET is_active = FALSE WHERE id = $1`,
      [id]
    );

    if (!rowCount) throw notFound("Gift item not found");

    return NextResponse.json({ success: true, data: null, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
