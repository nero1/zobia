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
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface GiftItemRow {
  id: string;
  name: string;
  emoji: string;
  coin_cost: number;
  star_cost: number | null;
  tier: number; // 1 (cheapest) – 5 (most spectacular)
  animation_key: string | null;
  spectacle_threshold_coins: number | null;
  is_active: boolean;
  sort_order: number;
}

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinCost: number;
  starCost: number | null;
  tier: number;
  animationKey: string | null;
  spectacleThresholdCoins: number | null;
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

const TIER_LABELS: Record<number, string> = {
  1: "Friendly",
  2: "Warm",
  3: "Grand",
  4: "Epic",
  5: "Legendary",
};

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
    const { rows } = await db.query<GiftItemRow>(
      `SELECT id, name, emoji, coin_cost, star_cost, tier,
              animation_key, spectacle_threshold_coins, is_active, sort_order
       FROM gift_items
       WHERE is_active = TRUE
       ORDER BY tier ASC, sort_order ASC, coin_cost ASC`
    );

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
        starCost: row.star_cost,
        tier: row.tier,
        animationKey: row.animation_key,
        spectacleThresholdCoins: row.spectacle_threshold_coins,
      });
    }

    const tiers = Array.from(tierMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([tier, gifts]) => ({
        tier,
        label: TIER_LABELS[tier] ?? `Tier ${tier}`,
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
