export const dynamic = 'force-dynamic';

/**
 * app/api/economy/boosters/route.ts
 *
 * GET  /api/economy/boosters — list active boost types (the Market's
 *   "Boosts & Passes" catalog, admin-managed via /gate44/boosts), plus the
 *   caller's own currently-active boosters (joined from user_xp_boosters —
 *   see `activeBoosters` in the response). Consumed by the Android wallet
 *   screen's "Active Boosters" section (apps/android/src/routes/wallet.tsx);
 *   web's wallet page has an `<BoosterPacks>` component for the same data
 *   but never actually wires it up (its `boosters` state is hardcoded to
 *   `[]` — a pre-existing, out-of-scope web bug left as-is here).
 * POST /api/economy/boosters — purchase and activate a boost.
 *
 * Body: { boosterType: string } — any active boost_types.key.
 *
 * Previously this route hardcoded a fixed BOOSTER_CONFIG map, so adding a
 * new boost type required a code deploy. It now reads the catalog from the
 * boost_types table (migration 0050) so admin can add new boost types from
 * gate44 without touching code — see lib/market/query.ts's Market
 * "Boosts & Passes" section, which reads the same table.
 *
 * IMPORTANT for the Capacitor Android app: Google Play Billing requires a
 * matching product to exist in Play Console for any boost with an
 * `iapProductId` before Android users can buy it — see
 * docs/HOW-IT-WORKS.md "Boosts & Play Billing".
 *
 * Inserts into user_xp_boosters (columns: user_id, booster_type, multiplier,
 * expires_at, is_active). Deducts coins atomically.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, conflict, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { debitCoins } from "@/lib/economy/coins";
import { triggerActivityQuestProgress } from "@/lib/quests/questEngine";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const purchaseBoosterSchema = z.object({
  boosterType: z.string().min(1).max(64),
});

interface BoostTypeRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  multiplier_bp: number;
  duration_hours: number;
  coins_cost: number | null;
  stackable: boolean;
}

// ---------------------------------------------------------------------------
// GET /api/economy/boosters
// ---------------------------------------------------------------------------

interface ActiveBoosterRow {
  id: string;
  booster_type: string;
  multiplier: number;
  expires_at: string;
  label: string | null;
  description: string | null;
}

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const orm = await getDb();
    const now = new Date();
    const [rows, activeRows] = await Promise.all([
      orm
        .select({
          id: schema.boostTypes.id,
          key: schema.boostTypes.key,
          label: schema.boostTypes.label,
          description: schema.boostTypes.description,
          multiplier_bp: schema.boostTypes.multiplierBp,
          duration_hours: schema.boostTypes.durationHours,
          coins_cost: schema.boostTypes.coinsCost,
          stackable: schema.boostTypes.stackable,
        })
        .from(schema.boostTypes)
        .where(eq(schema.boostTypes.isActive, true))
        .orderBy(asc(schema.boostTypes.sortOrder)),
      orm
        .select({
          id: schema.userXpBoosters.id,
          booster_type: schema.userXpBoosters.boosterType,
          multiplier: schema.userXpBoosters.multiplier,
          expires_at: schema.userXpBoosters.expiresAt,
          label: schema.boostTypes.label,
          description: schema.boostTypes.description,
        })
        .from(schema.userXpBoosters)
        .leftJoin(schema.boostTypes, eq(schema.boostTypes.key, schema.userXpBoosters.boosterType))
        .where(
          and(
            eq(schema.userXpBoosters.userId, auth.user.sub),
            eq(schema.userXpBoosters.isActive, true),
            gt(schema.userXpBoosters.expiresAt, now)
          )
        )
        .orderBy(asc(schema.userXpBoosters.expiresAt)),
    ]);
    return NextResponse.json({
      success: true,
      data: { boosts: rows, activeBoosters: activeRows },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/economy/boosters
// ---------------------------------------------------------------------------

/**
 * Purchase and activate a boost.
 *
 * Validates the boost type against the active catalog, checks coin balance,
 * atomically debits coins, and inserts an active booster record into
 * user_xp_boosters.
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, purchaseBoosterSchema);
    const userId = auth.user.sub;
    const boosterType = body.boosterType;

    const orm = await getDb();
    const [config] = await orm
      .select({
        id: schema.boostTypes.id,
        key: schema.boostTypes.key,
        label: schema.boostTypes.label,
        description: schema.boostTypes.description,
        multiplier_bp: schema.boostTypes.multiplierBp,
        duration_hours: schema.boostTypes.durationHours,
        coins_cost: schema.boostTypes.coinsCost,
        stackable: schema.boostTypes.stackable,
      })
      .from(schema.boostTypes)
      .where(and(eq(schema.boostTypes.key, boosterType), eq(schema.boostTypes.isActive, true)))
      .limit(1);
    if (!config) {
      throw notFound(`Unknown or inactive boost type: ${boosterType}`);
    }
    const cost = config.coins_cost ?? 0;

    // Check that the user can afford the booster
    const [userRow] = await orm
      .select({ coin_balance: schema.users.coinBalance })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);

    if (!userRow) {
      throw badRequest("User not found", "USER_NOT_FOUND");
    }

    if (Number(userRow.coin_balance) < cost) {
      throw badRequest(
        `Insufficient coins. This booster costs ${cost} coins.`,
        "INSUFFICIENT_BALANCE"
      );
    }

    // Non-stackable boosters (most of them) block duplicates while active.
    if (!config.stackable) {
      const [existingRow] = await orm
        .select({ id: schema.userXpBoosters.id })
        .from(schema.userXpBoosters)
        .where(
          and(
            eq(schema.userXpBoosters.userId, userId),
            eq(schema.userXpBoosters.boosterType, boosterType),
            eq(schema.userXpBoosters.isActive, true),
            gt(schema.userXpBoosters.expiresAt, new Date())
          )
        )
        .limit(1);

      if (existingRow) {
        throw conflict(
          `You already have an active ${boosterType} booster. Wait for it to expire before purchasing another.`,
          "BOOSTER_ALREADY_ACTIVE"
        );
      }
    }

    // Compute expiry
    const expiresAt = new Date(Date.now() + config.duration_hours * 60 * 60 * 1000);

    // Atomically debit coins and insert booster record
    const booster = await orm.transaction(async (tx) => {
      // Debit coins using the economy module (handles ledger + balance update atomically)
      await debitCoins(
        userId,
        cost,
        "booster_purchase",
        null,
        `Purchased ${boosterType}: ${config.description ?? config.label}`,
        { boosterType },
        tx
      );

      // Insert the booster record
      const [boosterRow] = await tx
        .insert(schema.userXpBoosters)
        .values({
          userId,
          boosterType,
          multiplier: config.multiplier_bp,
          expiresAt,
          isActive: true,
        })
        .returning({
          id: schema.userXpBoosters.id,
          user_id: schema.userXpBoosters.userId,
          booster_type: schema.userXpBoosters.boosterType,
          multiplier: schema.userXpBoosters.multiplier,
          expires_at: schema.userXpBoosters.expiresAt,
          is_active: schema.userXpBoosters.isActive,
          created_at: schema.userXpBoosters.createdAt,
        });

      return boosterRow;
    });

    void triggerActivityQuestProgress(userId, "market_purchase", orm);

    return NextResponse.json(
      {
        success: true,
        data: {
          booster,
          coinsSpent: cost,
          description: config.description ?? config.label,
        },
        error: null,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
