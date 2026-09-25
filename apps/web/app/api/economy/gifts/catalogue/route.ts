export const dynamic = 'force-dynamic';

/**
 * GET /api/economy/gifts/catalogue
 *
 * Returns all active gift items grouped by tier.
 *
 * Gifts are items purchasable with coins and sent to other users in DMs or
 * Rooms. Each gift has a tier (1–5) that determines its visual spectacle.
 *
 * Response is not user-specific — the same catalogue applies to all users.
 * Cache with stale-while-revalidate on the client; backend reads from DB each
 * time (gift data changes infrequently; add Redis caching later if needed).
 *
 * @module app/api/economy/gifts/catalogue
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { GIFT_TIER_LABELS } from "@zobia/shared/utils";

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface GiftItemRow {
  id: string;
  name: string;
  emoji: string;
  coin_cost: number;
  tier: number; // 1 (cheapest) – 5 (most spectacular)
  animation_url: string | null;
  spectacle_threshold_coins: number | null;
  is_active: boolean;
  is_rewarded: boolean;
  reward_config: { benefitType: string; label: string; description?: string } | null;
}

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinCost: number;
  tier: number;
  animationUrl: string | null;
  spectacleThresholdCoins: number | null;
  isRewarded: boolean;
  rewardLabel: string | null;
  rewardDescription: string | null;
}

interface GiftCatalogue {
  tiers: {
    tier: number;
    label: string;
    gifts: GiftItem[];
  }[];
}

// ---------------------------------------------------------------------------
// Tier labels
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * GET /api/economy/gifts/catalogue
 *
 * Returns active gift items grouped by tier (ascending).
 */
export const GET = withAuth(async (_req: NextRequest, _ctx) => {
  try {
    const orm = await getDb();
    const dbRows = await orm
      .select({
        id: schema.giftItems.id,
        name: schema.giftItems.name,
        emoji: schema.giftItems.emoji,
        coin_cost: schema.giftItems.coinCost,
        tier: schema.giftItems.tier,
        animation_url: schema.giftItems.animationUrl,
        spectacle_threshold_coins: schema.giftItems.spectacleThresholdCoins,
        is_active: schema.giftItems.isActive,
        is_rewarded: schema.giftItems.isRewarded,
        reward_config: schema.giftItems.rewardConfig,
      })
      .from(schema.giftItems)
      .where(and(eq(schema.giftItems.isActive, true), eq(schema.giftItems.isRetired, false)))
      .orderBy(asc(schema.giftItems.tier), asc(schema.giftItems.coinCost));

    const rows: GiftItemRow[] = dbRows.map((r) => ({
      ...r,
      coin_cost: Number(r.coin_cost),
      is_active: r.is_active ?? false,
      reward_config: r.reward_config as GiftItemRow["reward_config"],
    }));

    // Group by tier
    const tierMap = new Map<number, GiftItem[]>();
    for (const row of rows) {
      if (!tierMap.has(row.tier)) {
        tierMap.set(row.tier, []);
      }
      tierMap.get(row.tier)!.push({
        id: row.id,
        name: row.name,
        emoji: row.emoji,
        coinCost: row.coin_cost,
        tier: row.tier,
        animationUrl: row.animation_url,
        spectacleThresholdCoins: row.spectacle_threshold_coins,
        isRewarded: row.is_rewarded,
        rewardLabel: row.is_rewarded ? row.reward_config?.label ?? null : null,
        rewardDescription: row.is_rewarded ? row.reward_config?.description ?? null : null,
      });
    }

    const tiers = Array.from(tierMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([tier, gifts]) => ({
        tier,
        label: GIFT_TIER_LABELS[tier] ?? `Tier ${tier}`,
        gifts,
      }));

    const catalogue: GiftCatalogue = { tiers };

    return NextResponse.json(catalogue, {
      headers: {
        // 5-minute client cache, 30-minute stale-while-revalidate
        "Cache-Control": "private, max-age=300, stale-while-revalidate=1800",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
