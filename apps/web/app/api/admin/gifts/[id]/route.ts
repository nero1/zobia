export const dynamic = 'force-dynamic';

/**
 * app/api/admin/gifts/[id]/route.ts
 *
 * PATCH  /api/admin/gifts/:id  — update a gift item
 * DELETE /api/admin/gifts/:id  — retire (soft-delete) a gift item
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { rewardConfigSchema, refineRewardFields } from "@/lib/economy/giftItems";

const updateGiftSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    emoji: z.string().min(1).max(10).optional(),
    coinCost: z.number().int().positive().optional(),
    tier: z.number().int().min(1).max(5).optional(),
    animationUrl: z.string().url().nullable().optional(),
    spectacleThresholdCoins: z.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
    // Rewarded Gifts (migration 0026). Omitted entirely -> unchanged; isRewarded
    // explicitly false -> reward_config is cleared.
    isRewarded: z.boolean().optional(),
    rewardConfig: rewardConfigSchema.nullable().optional(),
  })
  .superRefine(refineRewardFields);

export const PATCH = withAdminAuth(async (req: NextRequest, ctx) => {
  try {
    const params = await ctx.params as { id?: string };
    const id = params?.id;
    if (!id) throw notFound("Gift item not found");

    const body = await validateBody(req, updateGiftSchema);

    const updates: Partial<typeof schema.giftItems.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.emoji !== undefined) updates.emoji = body.emoji;
    if (body.coinCost !== undefined) updates.coinCost = BigInt(body.coinCost);
    if (body.tier !== undefined) updates.tier = body.tier;
    if (body.animationUrl !== undefined) updates.animationUrl = body.animationUrl ?? null;
    if (body.spectacleThresholdCoins !== undefined) updates.spectacleThresholdCoins = body.spectacleThresholdCoins ?? null;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.isRewarded !== undefined) updates.isRewarded = body.isRewarded;
    if (body.rewardConfig !== undefined) updates.rewardConfig = body.rewardConfig ?? null;
    // Turning rewarded off clears any stale reward_config unless the caller
    // explicitly also sent a new one in this same request.
    if (body.isRewarded === false && body.rewardConfig === undefined) {
      updates.rewardConfig = null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: true, data: null, error: null });
    }

    const orm = await getDb();
    const result = await orm
      .update(schema.giftItems)
      .set(updates)
      .where(eq(schema.giftItems.id, id))
      .returning({ id: schema.giftItems.id });

    if (result.length === 0) throw notFound("Gift item not found");

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

    const orm = await getDb();
    const result = await orm
      .update(schema.giftItems)
      .set({ isActive: false })
      .where(eq(schema.giftItems.id, id))
      .returning({ id: schema.giftItems.id });

    if (result.length === 0) throw notFound("Gift item not found");

    return NextResponse.json({ success: true, data: null, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
