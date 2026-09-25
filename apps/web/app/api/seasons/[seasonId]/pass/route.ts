export const dynamic = 'force-dynamic';

/**
 * app/api/seasons/[seasonId]/pass/route.ts
 *
 * Season pass endpoints.
 *
 * GET  /api/seasons/[seasonId]/pass
 *   - Returns the calling user's season pass for this season.
 *   - Creates a free pass record if one doesn't exist yet.
 *
 * POST /api/seasons/[seasonId]/pass
 *   - Purchase the paid season pass.
 *   - Costs pass_price_coins (from the season record).
 *   - Deducted atomically from the user's coin balance.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { debitCoins } from "@/lib/economy/coins";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound, conflict } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// GET /api/seasons/[seasonId]/pass
// ---------------------------------------------------------------------------

/**
 * Get or create the user's free season pass for the given season.
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { seasonId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { seasonId } = params;
      const userId = auth.user.sub;

      const orm = await getDb();

      const [season] = await orm
        .select({
          id: schema.seasons.id,
          name: schema.seasons.name,
          isActive: schema.seasons.isActive,
          passPriceCoins: schema.seasons.passPriceCoins,
          endsAt: schema.seasons.endsAt,
        })
        .from(schema.seasons)
        .where(eq(schema.seasons.id, seasonId))
        .limit(1);
      if (!season) throw notFound("Season not found");

      // Upsert free pass record
      const [pass] = await orm
        .insert(schema.userSeasonPasses)
        .values({ userId, seasonId, isPaid: false, seasonXp: BigInt(0) })
        .onConflictDoUpdate({
          target: [schema.userSeasonPasses.userId, schema.userSeasonPasses.seasonId],
          set: { updatedAt: new Date() },
        })
        .returning();

      return NextResponse.json({
        success: true,
        data: {
          pass: {
            id: pass.id,
            user_id: pass.userId,
            season_id: pass.seasonId,
            is_paid: pass.isPaid,
            season_xp: Number(pass.seasonXp),
            season_rank: pass.seasonRank,
            purchased_at: pass.purchasedAt,
            created_at: pass.createdAt,
          },
          season: {
            id: season.id,
            name: season.name,
            is_active: season.isActive,
            pass_price_coins: season.passPriceCoins,
            ends_at: season.endsAt,
          },
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/seasons/[seasonId]/pass
// ---------------------------------------------------------------------------

/**
 * Purchase the paid season pass. Costs pass_price_coins from the season record.
 * Atomically deducts from the user's coin balance.
 */
export const POST = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { seasonId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { seasonId } = params;
      const userId = auth.user.sub;

      const orm = await getDb();

      const result = await orm.transaction(async (tx) => {
        // 1. Lock and verify season
        const [season] = await tx
          .select({
            id: schema.seasons.id,
            name: schema.seasons.name,
            isActive: schema.seasons.isActive,
            passPriceCoins: schema.seasons.passPriceCoins,
            endsAt: schema.seasons.endsAt,
          })
          .from(schema.seasons)
          .where(eq(schema.seasons.id, seasonId))
          .for("update");
        if (!season) throw notFound("Season not found");
        if (!season.isActive || new Date(season.endsAt) <= new Date()) {
          throw badRequest("Season is no longer active", "SEASON_ENDED");
        }

        // 2. Check user doesn't already have paid pass
        const [existingPass] = await tx
          .select({ isPaid: schema.userSeasonPasses.isPaid })
          .from(schema.userSeasonPasses)
          .where(and(eq(schema.userSeasonPasses.userId, userId), eq(schema.userSeasonPasses.seasonId, seasonId)));
        if (existingPass?.isPaid) {
          throw conflict("You already own the paid pass for this season", "PASS_ALREADY_OWNED");
        }

        // 3. Read user's plan; apply plan discount. debitCoins below locks and
        // reads the coin balance itself, so we only need the plan here.
        const [userRow] = await tx
          .select({ plan: schema.users.plan })
          .from(schema.users)
          .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
          .for("update");
        if (!userRow) throw notFound("User not found");

        const { plan } = userRow;

        // Determine discount percentage based on plan (PRD §3)
        const PLAN_DISCOUNTS: Record<string, number> = {
          plus: 10,
          pro: 20,
          max: 30,
        };
        const discountPercent = PLAN_DISCOUNTS[plan] ?? 0;
        const originalPrice = season.passPriceCoins;
        const discountedPrice = Math.floor(originalPrice * (1 - discountPercent / 100));

        // SYS-CL-06: scope the reference per user so repeat purchase attempts for the
        // same season by different users don't collide on the coin_ledger unique index.
        let ledgerEntry;
        try {
          ledgerEntry = await debitCoins(
            userId,
            discountedPrice,
            "season_pass_purchase",
            `season_pass:${seasonId}:${userId}`,
            `Season pass: ${season.name}`,
            null,
            tx
          );
        } catch (err) {
          if ((err as NodeJS.ErrnoException)?.code === "INSUFFICIENT_BALANCE") {
            throw badRequest(
              `Insufficient coins. Pass costs ${discountedPrice} coins.`,
              "INSUFFICIENT_BALANCE"
            );
          }
          throw err;
        }

        // 4. Upsert pass as paid
        const [pass] = await tx
          .insert(schema.userSeasonPasses)
          .values({ userId, seasonId, isPaid: true, seasonXp: BigInt(0), purchasedAt: new Date() })
          .onConflictDoUpdate({
            target: [schema.userSeasonPasses.userId, schema.userSeasonPasses.seasonId],
            set: { isPaid: true, purchasedAt: new Date(), updatedAt: new Date() },
          })
          .returning();

        return {
          pass: {
            id: pass.id,
            user_id: pass.userId,
            season_id: pass.seasonId,
            is_paid: pass.isPaid,
            season_xp: Number(pass.seasonXp),
            season_rank: pass.seasonRank,
            purchased_at: pass.purchasedAt,
            created_at: pass.createdAt,
          },
          coinsSpent: discountedPrice,
          newCoinBalance: ledgerEntry.balance_after,
          originalPrice,
          discountPercent,
          discountedPrice,
        };
      });

      return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
