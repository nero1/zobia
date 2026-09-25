export const dynamic = 'force-dynamic';

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
import { and, asc, isNull, or, gt, eq, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { loadManifest } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface StoreItemRow {
  id: string;
  name: string;
  description: string | null;
  item_type: "coin_pack" | "star_pack" | "booster" | "cosmetic";
  price_kobo: number | null;
  currency: string | null;
  coins_cost: number | null;
  stars_cost: number | null;
  coins_granted: number | null;
  stars_granted: number | null;
  bonus_label: string | null;
  iap_product_id: string | null;
  cosmetic_type: string | null;
  is_exclusive: boolean;
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
    const orm = await getDb();
    const [manifest, dbRows] = await Promise.all([
      loadManifest(),
      orm
        .select({
          id: schema.storeItems.id,
          name: schema.storeItems.name,
          description: schema.storeItems.description,
          item_type: schema.storeItems.itemType,
          price_kobo: schema.storeItems.priceKobo,
          currency: schema.storeItems.currency,
          coins_cost: schema.storeItems.coinsCost,
          stars_cost: schema.storeItems.starsCost,
          coins_granted: schema.storeItems.coinsGranted,
          stars_granted: schema.storeItems.starsGranted,
          bonus_label: schema.storeItems.bonusLabel,
          iap_product_id: schema.storeItems.iapProductId,
          cosmetic_type: schema.storeItems.cosmeticType,
          is_exclusive: schema.storeItems.isExclusive,
          is_featured: schema.storeItems.isFeatured,
          sort_order: schema.storeItems.sortOrder,
          metadata: schema.storeItems.metadata,
        })
        .from(schema.storeItems)
        .where(
          and(
            eq(schema.storeItems.isActive, true),
            or(isNull(schema.storeItems.validUntil), gt(schema.storeItems.validUntil, sql`NOW()`))
          )
        )
        .orderBy(asc(schema.storeItems.itemType), asc(schema.storeItems.sortOrder), sql`${schema.storeItems.priceKobo} ASC NULLS LAST`),
    ]);

    const rows: StoreItemRow[] = dbRows.map((r) => ({
      ...r,
      item_type: r.item_type as StoreItemRow["item_type"],
      price_kobo: r.price_kobo !== null ? Number(r.price_kobo) : null,
      coins_cost: r.coins_cost !== null ? Number(r.coins_cost) : null,
      coins_granted: r.coins_granted !== null ? Number(r.coins_granted) : null,
      is_exclusive: r.is_exclusive ?? false,
      metadata: r.metadata as Record<string, unknown> | null,
    }));

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
        iapProductId: r.iap_product_id ?? null,
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

    const cosmetics = rows
      .filter((r) => r.item_type === "cosmetic")
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        cosmeticType: r.cosmetic_type,
        starsCost: r.stars_cost,
        coinsCost: r.coins_cost,
        isExclusive: r.is_exclusive,
        isFeatured: r.is_featured,
        metadata: r.metadata,
      }));

    return NextResponse.json({
      coinPacks,
      starPacks,
      boosters,
      cosmetics,
      paymentEnabled: manifest.payment.primaryProvider !== "none",
      activeProvider: manifest.payment.primaryProvider,
      currenciesAccepted: manifest.payment.currenciesAccepted,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
