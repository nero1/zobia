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
import { and, asc, eq, exists, gt, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound, forbidden } from "@/lib/api/errors";
import { debitCoins } from "@/lib/economy/coins";
import { debitStars } from "@/lib/economy/stars";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { triggerActivityQuestProgress } from "@/lib/quests/questEngine";

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
    const orm = await getDb();
    const userId = auth.user.sub;
    const rows = await orm
      .select({
        id: schema.storeItems.id,
        name: schema.storeItems.name,
        description: schema.storeItems.description,
        cosmetic_type: schema.storeItems.cosmeticType,
        stars_cost: schema.storeItems.starsCost,
        coins_cost: schema.storeItems.coinsCost,
        is_exclusive: schema.storeItems.isExclusive,
        is_featured: schema.storeItems.isFeatured,
        season_id: schema.storeItems.seasonId,
        prestige_required: schema.storeItems.prestigeRequired,
        sort_order: schema.storeItems.sortOrder,
        owned: exists(
          orm
            .select({ one: sql`1` })
            .from(schema.userCosmetics)
            .where(
              and(
                eq(schema.userCosmetics.userId, userId),
                eq(schema.userCosmetics.storeItemId, schema.storeItems.id)
              )
            )
        ),
      })
      .from(schema.storeItems)
      .where(
        and(
          eq(schema.storeItems.itemType, "cosmetic"),
          eq(schema.storeItems.isActive, true),
          or(isNull(schema.storeItems.validUntil), gt(schema.storeItems.validUntil, new Date()))
        )
      )
      .orderBy(asc(schema.storeItems.sortOrder), asc(schema.storeItems.name));

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
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, purchaseSchema);
    const userId = auth.user.sub;

    // 1. Load item
    const orm = await getDb();
    const [item] = await orm
      .select({
        id: schema.storeItems.id,
        name: schema.storeItems.name,
        cosmetic_type: schema.storeItems.cosmeticType,
        stars_cost: schema.storeItems.starsCost,
        coins_cost: sql<number | null>`${schema.storeItems.coinsCost}::int`,
        is_exclusive: schema.storeItems.isExclusive,
        season_id: schema.storeItems.seasonId,
        prestige_required: schema.storeItems.prestigeRequired,
        is_active: schema.storeItems.isActive,
        valid_until: schema.storeItems.validUntil,
      })
      .from(schema.storeItems)
      .where(and(eq(schema.storeItems.id, body.itemId), eq(schema.storeItems.itemType, "cosmetic")))
      .limit(1);

    if (!item) throw notFound("Cosmetic item not found");
    if (!item.is_active) throw badRequest("This item is no longer available", "ITEM_INACTIVE");
    if (item.valid_until && new Date(item.valid_until) <= new Date()) {
      throw badRequest("This limited-edition item has expired", "ITEM_EXPIRED");
    }

    // 2. Season gate: if item is season-limited, verify the season is active
    if (item.season_id) {
      const [seasonRow] = await orm
        .select({ id: schema.seasons.id })
        .from(schema.seasons)
        .where(and(eq(schema.seasons.id, item.season_id), eq(schema.seasons.isActive, true), gt(schema.seasons.endsAt, new Date())))
        .limit(1);
      if (!seasonRow) {
        throw badRequest("This seasonal item is only available during its Season", "SEASON_ENDED");
      }
    }

    // 3. Exclusive gate: stars-only items cannot be purchased with coins
    if (item.is_exclusive && body.currency === "coins") {
      throw forbidden("This exclusive item can only be purchased with Stars");
    }

    // 4. Load user balance and prestige count
    const [userRow] = await orm
      .select({
        star_balance: schema.users.starBalance,
        coin_balance: schema.users.coinBalance,
        prestige_count: schema.users.prestigeCount,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);

    if (!userRow) throw forbidden("User account not found");
    const user = {
      star_balance: Number(userRow.star_balance ?? 0),
      coin_balance: Number(userRow.coin_balance ?? 0),
      prestige_count: userRow.prestige_count ?? 0,
    };

    // 5. Prestige gate
    if (item.prestige_required && user.prestige_count < item.prestige_required) {
      throw forbidden(
        `This item requires Prestige ${item.prestige_required} or higher`
      );
    }

    // 6. Idempotency: if user already owns this item, return 200 without charging
    const [existingRow] = await orm
      .select({ id: schema.userCosmetics.id })
      .from(schema.userCosmetics)
      .where(and(eq(schema.userCosmetics.userId, userId), eq(schema.userCosmetics.storeItemId, body.itemId)))
      .limit(1);

    if (existingRow) {
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

    // 8. Atomic: debit currency and grant item.
    // SYS-CL-10: scope both currencies' references per-user so different users
    // buying the same item don't collide on the ledger unique index.
    await orm.transaction(async (tx) => {
      if (body.currency === "stars") {
        await debitStars(
          userId,
          item.stars_cost!,
          "cosmetic_purchase",
          `cosmetic_purchase:${body.itemId}:${userId}`,
          `Purchased cosmetic: ${item.name}`,
          tx
        );
      } else {
        await debitCoins(
          userId,
          item.coins_cost!,
          "cosmetic_purchase",
          `cosmetic_purchase:${body.itemId}:${userId}`,
          `Purchased cosmetic: ${item.name}`,
          { itemId: body.itemId, cosmeticType: item.cosmetic_type },
          tx
        );
      }

      await tx
        .insert(schema.userCosmetics)
        .values({
          userId,
          storeItemId: body.itemId,
          cosmeticType: item.cosmetic_type ?? "",
          isActive: false,
        })
        .onConflictDoNothing({
          target: [schema.userCosmetics.userId, schema.userCosmetics.storeItemId],
        });
    });

    void triggerActivityQuestProgress(userId, "market_purchase", orm);

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
