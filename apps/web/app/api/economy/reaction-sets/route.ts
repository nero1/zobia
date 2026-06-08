export const dynamic = 'force-dynamic';

/**
 * app/api/economy/reaction-sets/route.ts
 *
 * Custom Reaction Set endpoints.
 *
 * GET /api/economy/reaction-sets
 *   List all active reaction sets with the caller's ownership status and
 *   the individual reactions within each set.
 *
 * POST /api/economy/reaction-sets
 *   Purchase a reaction set. Deducts the coin price from the caller's
 *   balance and grants them access to the set.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const purchaseSchema = z.object({
  setId: z.string().uuid("setId must be a valid UUID"),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface ReactionSetRow {
  id: string;
  name: string;
  description: string | null;
  coin_price: number;
  preview_emoji: string;
  is_active: boolean;
  created_at: string;
}

interface ReactionSetItemRow {
  id: string;
  set_id: string;
  emoji: string;
  name: string;
  sort_order: number;
}

// ---------------------------------------------------------------------------
// GET /api/economy/reaction-sets
// ---------------------------------------------------------------------------

/**
 * Return all active reaction sets with the caller's ownership status.
 *
 * @returns JSON array of reaction sets, each with an `owned` boolean and
 *          a `reactions` array of individual reaction items.
 */
export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const userId = auth.user.sub;

    // Fetch all active sets
    const { rows: sets } = await db.query<ReactionSetRow>(
      `SELECT id, name, description, coin_price, preview_emoji, is_active, created_at
       FROM reaction_sets
       WHERE is_active = TRUE
       ORDER BY coin_price ASC`,
      []
    );

    if (sets.length === 0) {
      return NextResponse.json({ reactionSets: [] });
    }

    const setIds = sets.map((s) => s.id);

    // Fetch all items for these sets
    const { rows: items } = await db.query<ReactionSetItemRow>(
      `SELECT id, set_id, emoji, name, sort_order
       FROM reaction_set_items
       WHERE set_id = ANY($1)
       ORDER BY set_id, sort_order ASC`,
      [setIds]
    );

    // Fetch which sets the caller already owns
    const { rows: owned } = await db.query<{ set_id: string }>(
      `SELECT set_id FROM user_reaction_sets WHERE user_id = $1`,
      [userId]
    );
    const ownedSetIds = new Set(owned.map((r) => r.set_id));

    // Build indexed items map
    const itemsBySetId = new Map<string, ReactionSetItemRow[]>();
    for (const item of items) {
      const list = itemsBySetId.get(item.set_id) ?? [];
      list.push(item);
      itemsBySetId.set(item.set_id, list);
    }

    const reactionSets = sets.map((set) => ({
      id: set.id,
      name: set.name,
      description: set.description,
      coinPrice: set.coin_price,
      previewEmoji: set.preview_emoji,
      owned: ownedSetIds.has(set.id),
      reactions: (itemsBySetId.get(set.id) ?? []).map((item) => ({
        id: item.id,
        emoji: item.emoji,
        name: item.name,
        sortOrder: item.sort_order,
      })),
      createdAt: set.created_at,
    }));

    return NextResponse.json({ reactionSets });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/economy/reaction-sets — purchase a reaction set
// ---------------------------------------------------------------------------

/**
 * Purchase a reaction set.
 *
 * Validates:
 *  - The set exists and is active.
 *  - The caller does not already own it.
 *  - The caller has sufficient coin balance.
 *
 * Atomically deducts coins and records ownership.
 *
 * @returns JSON { reactionSet, newBalance } with status 201
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const userId = auth.user.sub;
    const { setId } = await validateBody(req, purchaseSchema);

    // Fetch set
    const { rows: setRows } = await db.query<ReactionSetRow>(
      `SELECT id, name, description, coin_price, preview_emoji, is_active
       FROM reaction_sets
       WHERE id = $1`,
      [setId]
    );
    const set = setRows[0];
    if (!set) throw notFound("Reaction set not found");
    if (!set.is_active) throw badRequest("This reaction set is no longer available");

    // Check if already owned
    const { rows: existingRows } = await db.query<{ set_id: string }>(
      `SELECT set_id FROM user_reaction_sets WHERE user_id = $1 AND set_id = $2`,
      [userId, setId]
    );
    if (existingRows.length > 0) {
      throw badRequest("You already own this reaction set");
    }

    // Fetch user balance
    const { rows: userRows } = await db.query<{
      coin_balance: number;
    }>(
      `SELECT coin_balance FROM users WHERE id = $1`,
      [userId]
    );
    const user = userRows[0];
    if (!user) throw notFound("User not found");

    const price = set.coin_price;
    if (user.coin_balance < price) {
      throw badRequest(
        `Insufficient coins. You need ${price.toLocaleString()} coins but have ${user.coin_balance.toLocaleString()}.`
      );
    }

    // Atomic purchase transaction
    const newBalance = await db.transaction(async (tx) => {
      // Deduct coins
      const { rows: updatedUser } = await tx.query<{ coin_balance: number }>(
        `UPDATE users
         SET coin_balance = coin_balance - $1, updated_at = NOW()
         WHERE id = $2 AND coin_balance >= $1
         RETURNING coin_balance`,
        [price, userId]
      );
      if (!updatedUser[0]) {
        throw badRequest("Insufficient coins (concurrent update)");
      }
      const balanceAfter = updatedUser[0].coin_balance;

      // Append to coin ledger
      await tx.query(
        `INSERT INTO coin_ledger
           (user_id, amount, balance_before, balance_after, transaction_type, reference_id, description)
         VALUES ($1, $2, $3, $4, 'booster_pack', $5, 'Reaction set purchase')`,
        [userId, -price, user.coin_balance, balanceAfter, setId]
      );

      // Grant ownership
      await tx.query(
        `INSERT INTO user_reaction_sets (user_id, set_id, purchased_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id, set_id) DO NOTHING`,
        [userId, setId]
      );

      return balanceAfter;
    });

    return NextResponse.json(
      {
        reactionSet: {
          id: set.id,
          name: set.name,
          description: set.description,
          coinPrice: set.coin_price,
          previewEmoji: set.preview_emoji,
        },
        newBalance,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
