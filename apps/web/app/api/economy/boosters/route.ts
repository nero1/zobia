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
import { db } from "@/lib/db";
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
    const [{ rows }, { rows: activeRows }] = await Promise.all([
      db.query<BoostTypeRow>(
        `SELECT id, key, label, description, multiplier_bp, duration_hours,
                coins_cost, stackable
         FROM boost_types WHERE is_active = TRUE ORDER BY sort_order ASC`
      ),
      db.query<ActiveBoosterRow>(
        `SELECT b.id, b.booster_type, b.multiplier, b.expires_at,
                t.label, t.description
         FROM user_xp_boosters b
         LEFT JOIN boost_types t ON t.key = b.booster_type
         WHERE b.user_id = $1 AND b.is_active = TRUE AND b.expires_at > NOW()
         ORDER BY b.expires_at ASC`,
        [auth.user.sub]
      ),
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

    const { rows: configRows } = await db.query<BoostTypeRow>(
      `SELECT id, key, label, description, multiplier_bp, duration_hours,
              coins_cost, stackable
       FROM boost_types WHERE key = $1 AND is_active = TRUE LIMIT 1`,
      [boosterType]
    );
    const config = configRows[0];
    if (!config) {
      throw notFound(`Unknown or inactive boost type: ${boosterType}`);
    }
    const cost = config.coins_cost ?? 0;

    // Check that the user can afford the booster
    const { rows: userRows } = await db.query<{ coin_balance: number }>(
      `SELECT coin_balance FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

    if (!userRows[0]) {
      throw badRequest("User not found", "USER_NOT_FOUND");
    }

    if (userRows[0].coin_balance < cost) {
      throw badRequest(
        `Insufficient coins. This booster costs ${cost} coins.`,
        "INSUFFICIENT_BALANCE"
      );
    }

    // Non-stackable boosters (most of them) block duplicates while active.
    if (!config.stackable) {
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
    const expiresAt = new Date(Date.now() + config.duration_hours * 60 * 60 * 1000);

    // Atomically debit coins and insert booster record
    const booster = await db.transaction(async (tx) => {
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
        [userId, boosterType, config.multiplier_bp, expiresAt.toISOString()]
      );

      return boosterRows[0];
    });

    void triggerActivityQuestProgress(userId, "market_purchase", db);

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
