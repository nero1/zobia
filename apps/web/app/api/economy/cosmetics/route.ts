export const dynamic = 'force-dynamic';

/**
 * app/api/economy/cosmetics/route.ts
 *
 * GET  /api/economy/cosmetics         — List all cosmetic items available in the store.
 * POST /api/economy/cosmetics/purchase — Purchase a cosmetic with Stars or Coins.
 *
 * PRD §11 (Zobia Stars section):
 *   "Stars are spent on: exclusive cosmetics, profile frames, and animated items
 *    not available for Coins. Unlocking rare titles. Purchasing limited-edition
 *    seasonal items when Coins are insufficient."
 *
 * Purchase rules:
 *   - Items with stars_cost > 0 require Stars as the currency.
 *   - Items with is_exclusive = TRUE cannot be purchased with Coins at all.
 *   - Items with a coins_cost can optionally be purchased with Coins.
 *   - Season-limited items (season_id IS NOT NULL) are only purchasable while
 *     the matching season is active.
 *   - Prestige-gated items require prestige_count >= prestige_required.
 *   - Purchasing adds the item to user_cosmetics (idempotent — re-purchase
 *     of an already-owned item returns 200 without charging again).
 *
 * Auth: required (withAuth).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound, forbidden } from "@/lib/api/errors";
import { debitCoins } from "@/lib/economy/coins";
import { debitStars } from "@/lib/economy/stars";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const purchaseSchema = z.object({
  /** UUID of the store_items row to purchase. */
  itemId: z.string().uuid("itemId must be a valid UUID"),
  /** Currency to pay with. Stars-only items require 'stars'. */
  currency: z.enum(["stars", "coins"]),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface CosmeticItemRow {
  id: string;
  name: string;
  cosmetic_type: string;
  stars_cost: number | null;
  coins_cost: number | null;
  is_exclusive: boolean;
  season_id: string | null;
  prestige_required: number | null;
  is_active: boolean;
  valid_until: string | null;
}

interface UserRow {
  star_balance: number;
  coin_balance: number;
  prestige_count: number;
}

interface ActiveSeasonRow {
  id: string;
}

// ---------------------------------------------------------------------------
// GET /api/economy/cosmetics
// ---------------------------------------------------------------------------

/**
 * Returns the full cosmetics catalogue (active, non-expired items).
 * Includes a `owned` flag indicating whether the requesting user already owns each item.
 */
export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const { rows } = await db.query<
      CosmeticItemRow & { owned: boolean }
    >(
      `SELECT
         si.id,
         si.name,
         si.description,
         si.cosmetic_type,
         si.stars_cost,
         si.coins_cost,
         si.is_exclusive,
         si.is_featured,
         si.season_id,
         si.prestige_required,
         si.sort_order,
         EXISTS (
           SELECT 1 FROM user_cosmetics uc
           WHERE uc.user_id = $1 AND uc.store_item_id = si.id
         ) AS owned
       FROM store_items si
       WHERE si.item_type = 'cosmetic'
         AND si.is_active = TRUE
         AND (si.valid_until IS NULL OR si.valid_until > NOW())
       ORDER BY si.sort_order ASC, si.name ASC`,
      [auth.user.sub]
    );

    return NextResponse.json({ cosmetics: rows });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/economy/cosmetics/purchase (handled as action on this route)
// ---------------------------------------------------------------------------

/**
 * Purchase a cosmetic item.
 *
 * Body: { itemId: string, currency: 'stars' | 'coins' }
 *
 * Returns: { itemId, cosmeticType, alreadyOwned }
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, purchaseSchema);
    const userId = auth.user.sub;

    // 1. Load item
    const { rows: itemRows } = await db.query<CosmeticItemRow>(
      `SELECT id, name, cosmetic_type, stars_cost, coins_cost, is_exclusive,
              season_id, prestige_required, is_active, valid_until
       FROM store_items
       WHERE id = $1 AND item_type = 'cosmetic'
       LIMIT 1`,
      [body.itemId]
    );

    const item = itemRows[0];
    if (!item) throw notFound("Cosmetic item not found");
    if (!item.is_active) throw badRequest("This item is no longer available", "ITEM_INACTIVE");
    if (item.valid_until && new Date(item.valid_until) <= new Date()) {
      throw badRequest("This limited-edition item has expired", "ITEM_EXPIRED");
    }

    // 2. Season gate: if item is season-limited, verify the season is active
    if (item.season_id) {
      const { rows: seasonRows } = await db.query<ActiveSeasonRow>(
        `SELECT id FROM seasons WHERE id = $1 AND is_active = TRUE AND ends_at > NOW() LIMIT 1`,
        [item.season_id]
      );
      if (!seasonRows[0]) {
        throw badRequest("This seasonal item is only available during its Season", "SEASON_ENDED");
      }
    }

    // 3. Exclusive gate: stars-only items cannot be purchased with coins
    if (item.is_exclusive && body.currency === "coins") {
      throw forbidden("This exclusive item can only be purchased with Stars");
    }

    // 4. Load user balance and prestige count
    const { rows: userRows } = await db.query<UserRow>(
      `SELECT COALESCE(star_balance, 0) AS star_balance,
              COALESCE(coin_balance, 0) AS coin_balance,
              COALESCE(prestige_count, 0) AS prestige_count
       FROM users
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [userId]
    );

    const user = userRows[0];
    if (!user) throw forbidden("User account not found");

    // 5. Prestige gate
    if (item.prestige_required && user.prestige_count < item.prestige_required) {
      throw forbidden(
        `This item requires Prestige ${item.prestige_required} or higher`
      );
    }

    // 6. Idempotency: if user already owns this item, return 200 without charging
    const { rows: existingRows } = await db.query<{ id: string }>(
      `SELECT id FROM user_cosmetics WHERE user_id = $1 AND store_item_id = $2 LIMIT 1`,
      [userId, body.itemId]
    );

    if (existingRows[0]) {
      return NextResponse.json({
        itemId: body.itemId,
        cosmeticType: item.cosmetic_type,
        alreadyOwned: true,
      });
    }

    // 7. Validate cost and sufficient balance
    if (body.currency === "stars") {
      const cost = item.stars_cost;
      if (!cost || cost <= 0) {
        throw badRequest("This item cannot be purchased with Stars");
      }
      if (user.star_balance < cost) {
        throw badRequest(
          `Insufficient Stars. You need ${cost} Stars but have ${user.star_balance}.`,
          "INSUFFICIENT_STARS"
        );
      }
    } else {
      const cost = item.coins_cost;
      if (!cost || cost <= 0) {
        throw badRequest("This item cannot be purchased with Coins");
      }
      if (user.coin_balance < cost) {
        throw badRequest(
          `Insufficient Coins. You need ${cost} Coins but have ${user.coin_balance}.`,
          "INSUFFICIENT_COINS"
        );
      }
    }

    // 8. Atomic: debit currency and grant item
    await db.transaction(async (tx) => {
      if (body.currency === "stars") {
        await debitStars(
          userId,
          item.stars_cost!,
          "cosmetic_purchase",
          body.itemId,
          `Purchased cosmetic: ${item.name}`,
          tx
        );
      } else {
        await debitCoins(
          userId,
          item.coins_cost!,
          "cosmetic_purchase",
          body.itemId,
          `Purchased cosmetic: ${item.name}`,
          { itemId: body.itemId, cosmeticType: item.cosmetic_type },
          tx
        );
      }

      await tx.query(
        `INSERT INTO user_cosmetics (user_id, store_item_id, cosmetic_type, is_active, acquired_at)
         VALUES ($1, $2, $3, FALSE, NOW())
         ON CONFLICT (user_id, store_item_id) DO NOTHING`,
        [userId, body.itemId, item.cosmetic_type]
      );
    });

    return NextResponse.json(
      {
        itemId: body.itemId,
        cosmeticType: item.cosmetic_type,
        alreadyOwned: false,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
