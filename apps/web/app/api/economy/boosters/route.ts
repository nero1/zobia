export const dynamic = 'force-dynamic';

/**
 * app/api/economy/boosters/route.ts
 *
 * POST /api/economy/boosters
 * Purchase and activate a booster pack.
 *
 * Body: { boosterType: "xp_booster" | "quest_accelerator" | "guild_war_boost" }
 *
 * Costs (coins):
 *   xp_booster:        200 coins → 2× XP for 24 hours
 *   quest_accelerator: 500 coins → +50% XP on quests for 7 days
 *   guild_war_boost:   300 coins → double personal War Points for next war
 *
 * Inserts into user_xp_boosters (columns: user_id, booster_type, multiplier,
 * expires_at, is_active). Deducts coins atomically.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { debitCoins } from "@/lib/economy/coins";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// BUG-007 FIX: multiplier stored as integer basis points (100 = 1.0×, 200 = 2.0×)
// to avoid decimal precision issues. Column type changed from decimal(4,2) to integer.
/** Booster configuration: cost in coins, XP multiplier in basis points, duration in hours. */
const BOOSTER_CONFIG = {
  xp_booster: {
    cost: 200,
    multiplier: 200, // 2.0× → 200 bp
    durationHours: 24,
    description: "2× XP for 24 hours",
  },
  quest_accelerator: {
    cost: 500,
    multiplier: 150, // 1.5× → 150 bp
    durationHours: 24 * 7, // 7 days
    description: "+50% XP on quests for 7 days",
  },
  guild_war_boost: {
    cost: 300,
    multiplier: 200, // 2.0× → 200 bp
    durationHours: 24 * 30, // expires after 30 days if war hasn't occurred
    description: "Double personal War Points for next guild war",
  },
  // Premium Send animation (PRD §11)
  premium_send: {
    cost: 50,
    multiplier: 0,
    durationHours: 24 * 365, // one-shot; expires after use or 1 year
    description: "Premium gold-shimmer animation on your next message",
  },
  premium_send_7day: {
    cost: 250,
    multiplier: 0,
    durationHours: 24 * 7, // 7-day subscription pass
    description: "Premium animations on all messages for 7 days",
  },
} as const;

type BoosterType = keyof typeof BOOSTER_CONFIG;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const purchaseBoosterSchema = z.object({
  boosterType: z.enum(
    ["xp_booster", "quest_accelerator", "guild_war_boost", "premium_send", "premium_send_7day"],
    {
      errorMap: () => ({
        message:
          "boosterType must be one of: xp_booster, quest_accelerator, guild_war_boost, premium_send, premium_send_7day",
      }),
    }
  ),
});

// ---------------------------------------------------------------------------
// POST /api/economy/boosters
// ---------------------------------------------------------------------------

/**
 * Purchase and activate a booster pack.
 *
 * Validates the booster type, checks coin balance, atomically debits coins,
 * and inserts an active booster record into user_xp_boosters.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, purchaseBoosterSchema);
    const userId = auth.user.sub;
    const boosterType = body.boosterType as BoosterType;
    const config = BOOSTER_CONFIG[boosterType];

    // Check that the user can afford the booster
    const { rows: userRows } = await db.query<{ coin_balance: number }>(
      `SELECT coin_balance FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

    if (!userRows[0]) {
      throw badRequest("User not found", "USER_NOT_FOUND");
    }

    if (userRows[0].coin_balance < config.cost) {
      throw badRequest(
        `Insufficient coins. This booster costs ${config.cost} coins.`,
        "INSUFFICIENT_BALANCE"
      );
    }

    // premium_send (one-shot) can stack; all other boosters block duplicates
    const blocksDuplicates = boosterType !== "premium_send";
    if (blocksDuplicates) {
      const { rows: existingRows } = await db.query<{ id: string }>(
        `SELECT id FROM user_xp_boosters
         WHERE user_id = $1 AND booster_type = $2 AND is_active = TRUE AND expires_at > NOW()
         LIMIT 1`,
        [userId, boosterType]
      );

      if (existingRows.length > 0) {
        throw conflict(
          `You already have an active ${boosterType} booster. Wait for it to expire before purchasing another.`,
          "BOOSTER_ALREADY_ACTIVE"
        );
      }
    }

    // Compute expiry
    const expiresAt = new Date(Date.now() + config.durationHours * 60 * 60 * 1000);

    // Atomically debit coins and insert booster record
    const booster = await db.transaction(async (tx) => {
      // Debit coins using the economy module (handles ledger + balance update atomically)
      await debitCoins(
        userId,
        config.cost,
        "booster_purchase",
        null,
        `Purchased ${boosterType}: ${config.description}`,
        { boosterType },
        tx
      );

      // Insert the booster record
      const { rows: boosterRows } = await tx.query<{
        id: string;
        user_id: string;
        booster_type: string;
        multiplier: number;
        expires_at: string;
        is_active: boolean;
        created_at: string;
      }>(
        `INSERT INTO user_xp_boosters
           (user_id, booster_type, multiplier, expires_at, is_active, created_at)
         VALUES ($1, $2, $3, $4, TRUE, NOW())
         RETURNING id, user_id, booster_type, multiplier, expires_at, is_active, created_at`,
        [userId, boosterType, config.multiplier, expiresAt.toISOString()]
      );

      return boosterRows[0];
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          booster,
          coinsSpent: config.cost,
          description: config.description,
        },
        error: null,
      },
      { status: 201 }
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "INSUFFICIENT_BALANCE") {
      return handleApiError(
        badRequest(
          `Insufficient coins to purchase this booster.`,
          "INSUFFICIENT_BALANCE"
        )
      );
    }
    return handleApiError(err);
  }
});
