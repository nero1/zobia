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
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
    const orm = await getDb();

    // Fetch all active sets
    const sets = await orm
      .select({
        id: schema.reactionSets.id,
        name: schema.reactionSets.name,
        description: schema.reactionSets.description,
        coinPrice: schema.reactionSets.coinPrice,
        previewEmoji: schema.reactionSets.previewEmoji,
        isActive: schema.reactionSets.isActive,
        createdAt: schema.reactionSets.createdAt,
      })
      .from(schema.reactionSets)
      .where(eq(schema.reactionSets.isActive, true))
      .orderBy(asc(schema.reactionSets.coinPrice));

    if (sets.length === 0) {
      return NextResponse.json({ reactionSets: [] });
    }

    const setIds = sets.map((s) => s.id);

    // Fetch all items for these sets
    const items = await orm
      .select({
        id: schema.reactionSetItems.id,
        setId: schema.reactionSetItems.setId,
        emoji: schema.reactionSetItems.emoji,
        name: schema.reactionSetItems.name,
        sortOrder: schema.reactionSetItems.sortOrder,
      })
      .from(schema.reactionSetItems)
      .where(inArray(schema.reactionSetItems.setId, setIds))
      .orderBy(asc(schema.reactionSetItems.setId), asc(schema.reactionSetItems.sortOrder));

    // Fetch which sets the caller already owns
    const owned = await orm
      .select({ setId: schema.userReactionSets.setId })
      .from(schema.userReactionSets)
      .where(eq(schema.userReactionSets.userId, userId));
    const ownedSetIds = new Set(owned.map((r) => r.setId));

    // Build indexed items map
    const itemsBySetId = new Map<string, typeof items>();
    for (const item of items) {
      const list = itemsBySetId.get(item.setId) ?? [];
      list.push(item);
      itemsBySetId.set(item.setId, list);
    }

    const reactionSets = sets.map((set) => ({
      id: set.id,
      name: set.name,
      description: set.description,
      coinPrice: set.coinPrice,
      previewEmoji: set.previewEmoji,
      owned: ownedSetIds.has(set.id),
      reactions: (itemsBySetId.get(set.id) ?? []).map((item) => ({
        id: item.id,
        emoji: item.emoji,
        name: item.name,
        sortOrder: item.sortOrder,
      })),
      createdAt: set.createdAt,
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
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const userId = auth.user.sub;
    const { setId } = await validateBody(req, purchaseSchema);
    const orm = await getDb();

    // Fetch set
    const [set] = await orm
      .select({
        id: schema.reactionSets.id,
        name: schema.reactionSets.name,
        description: schema.reactionSets.description,
        coinPrice: schema.reactionSets.coinPrice,
        previewEmoji: schema.reactionSets.previewEmoji,
        isActive: schema.reactionSets.isActive,
      })
      .from(schema.reactionSets)
      .where(eq(schema.reactionSets.id, setId))
      .limit(1);
    if (!set) throw notFound("Reaction set not found");
    if (!set.isActive) throw badRequest("This reaction set is no longer available");

    // Check if already owned
    const [existing] = await orm
      .select({ setId: schema.userReactionSets.setId })
      .from(schema.userReactionSets)
      .where(
        and(
          eq(schema.userReactionSets.userId, userId),
          eq(schema.userReactionSets.setId, setId)
        )
      )
      .limit(1);
    if (existing) {
      throw badRequest("You already own this reaction set");
    }

    // Fetch user balance
    const [user] = await orm
      .select({ coinBalance: schema.users.coinBalance })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) throw notFound("User not found");

    const price = BigInt(set.coinPrice);
    if (user.coinBalance < price) {
      throw badRequest(
        `Insufficient coins. You need ${price.toLocaleString()} coins but have ${user.coinBalance.toLocaleString()}.`
      );
    }

    // Atomic purchase transaction
    const newBalance = await orm.transaction(async (tx) => {
      // Deduct coins
      const [updatedUser] = await tx
        .update(schema.users)
        .set({ coinBalance: sql`${schema.users.coinBalance} - ${price}`, updatedAt: new Date() })
        .where(and(eq(schema.users.id, userId), sql`${schema.users.coinBalance} >= ${price}`))
        .returning({ coinBalance: schema.users.coinBalance });
      if (!updatedUser) {
        throw badRequest("Insufficient coins (concurrent update)");
      }
      const balanceAfter = updatedUser.coinBalance;

      // Append to coin ledger
      await tx.insert(schema.coinLedger).values({
        userId,
        amount: -price,
        balanceBefore: user.coinBalance,
        balanceAfter,
        transactionType: "booster_pack",
        referenceId: setId,
        description: "Reaction set purchase",
      });

      // Grant ownership
      await tx
        .insert(schema.userReactionSets)
        .values({ userId, setId })
        .onConflictDoNothing();

      return balanceAfter;
    });

    return NextResponse.json(
      {
        reactionSet: {
          id: set.id,
          name: set.name,
          description: set.description,
          coinPrice: set.coinPrice,
          previewEmoji: set.previewEmoji,
        },
        newBalance: Number(newBalance),
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
