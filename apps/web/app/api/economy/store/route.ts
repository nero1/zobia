/**
 * GET /api/economy/store
 *
 * Returns the full in-app store catalogue:
 *   - Coin packs (purchasable for real money)
 *   - Star packs (purchasable for real money, scarcer currency)
 *   - Booster packs (purchasable for coins — XP boosts, profile effects, etc.)
 *
 * Items are sourced from the `store_items` table. The `is_active` flag and
 * `valid_until` date are respected; expired or disabled items are excluded.
 *
 * @module app/api/economy/store
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { loadManifest } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface StoreItemRow {
  id: string;
  name: string;
  description: string | null;
  item_type: "coin_pack" | "star_pack" | "booster";
  price_kobo: number | null;
  currency: string | null;
  coins_cost: number | null; // for booster items paid in coins
  coins_granted: number | null;
  stars_granted: number | null;
  bonus_label: string | null; // e.g. "+20% BONUS"
  is_featured: boolean;
  sort_order: number;
  metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * GET /api/economy/store
 *
 * Returns coin packs, star packs, and booster items available for purchase.
 */
export const GET = withAuth(async (_req: NextRequest, _ctx) => {
  try {
    const [manifest, { rows }] = await Promise.all([
      loadManifest(),
      db.query<StoreItemRow>(
        `SELECT id, name, description, item_type, price_kobo, currency,
                coins_cost, coins_granted, stars_granted, bonus_label,
                is_featured, sort_order, metadata
         FROM store_items
         WHERE is_active = TRUE
           AND (valid_until IS NULL OR valid_until > NOW())
         ORDER BY item_type ASC, sort_order ASC, price_kobo ASC NULLS LAST`
      ),
    ]);

    const coinPacks = rows
      .filter((r) => r.item_type === "coin_pack")
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        priceKobo: r.price_kobo,
        currency: r.currency ?? "NGN",
        coinsGranted: r.coins_granted,
        bonusLabel: r.bonus_label,
        isFeatured: r.is_featured,
      }));

    const starPacks = rows
      .filter((r) => r.item_type === "star_pack")
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        priceKobo: r.price_kobo,
        currency: r.currency ?? "NGN",
        starsGranted: r.stars_granted,
        bonusLabel: r.bonus_label,
        isFeatured: r.is_featured,
      }));

    const boosters = rows
      .filter((r) => r.item_type === "booster")
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        coinsCost: r.coins_cost,
        isFeatured: r.is_featured,
        metadata: r.metadata,
      }));

    return NextResponse.json({
      coinPacks,
      starPacks,
      boosters,
      paymentEnabled: manifest.payment.primaryProvider !== "none",
      activeProvider: manifest.payment.primaryProvider,
      currenciesAccepted: manifest.payment.currenciesAccepted,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
