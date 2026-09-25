export const dynamic = 'force-dynamic';

/**
 * app/api/guilds/route.ts
 *
 * Guild discovery and creation.
 *
 * GET /api/guilds
 *   - Browse guilds with optional filters: city, tier, open_only
 *   - Returns paginated list of guilds with stats
 *
 * POST /api/guilds
 *   - Create a new guild (costs 500 Coins, deducted atomically)
 *   - Checks user doesn't already belong to a guild
 *   - Creates guild + guild_member record with captain role
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden } from "@/lib/api/errors";
import { meetsMinimumTrust } from "@/lib/trust/trustScore";
import { loadManifest } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GUILD_CREATION_COST_COINS = 500;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createGuildSchema = z.object({
  name: z.string().min(3).max(40),
  crestEmoji: z.string().min(1).max(4),
  description: z.string().max(300).optional(),
  city: z.string().max(80).optional(),
  country: z.string().length(2),
  recruitmentType: z.enum(["open", "approval", "invite_only"]).default("open"),
});

// ---------------------------------------------------------------------------
// GET /api/guilds
// ---------------------------------------------------------------------------

/**
 * Browse guilds with optional filters.
 * Supports city, tier, and open_only query params.
 */

/**
 * Whether the current user can create a guild right now, and why not if not —
 * surfaced on the Browse Guilds page so the Create Guild button can show the
 * exact gate (level / trust / coins / already-in-a-guild) before they click,
 * not just on a failed POST.
 */
async function getCreateEligibility(userId: string) {
  const manifest = await loadManifest();
  const minLevel = manifest.guilds.minLevelToCreate;
  const orm = await getDb();

  const rows = await orm
    .select({
      rankLevel: sql<number>`COALESCE(${schema.users.rankLevel}, 1)`,
      trustScore: sql<number>`COALESCE(${schema.users.trustScore}, 50)`,
      coinBalance: sql<string>`COALESCE(${schema.users.coinBalance}, 0)`,
      guildId: schema.users.guildId,
    })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { canCreate: false, minLevel, currentLevel: 1, minTrustScore: 30, currentTrustScore: 0, costCoins: GUILD_CREATION_COST_COINS, currentCoinBalance: 0, alreadyInGuild: false };
  }

  const trusted = await meetsMinimumTrust(userId, "guild_creation", orm);
  const coinBalance = Number(row.coinBalance);
  const alreadyInGuild = row.guildId !== null;
  const hasLevel = row.rankLevel >= minLevel;
  const hasCoins = coinBalance >= GUILD_CREATION_COST_COINS;

  return {
    canCreate: !alreadyInGuild && hasLevel && trusted && hasCoins,
    minLevel,
    currentLevel: row.rankLevel,
    minTrustScore: 30,
    currentTrustScore: row.trustScore,
    costCoins: GUILD_CREATION_COST_COINS,
    currentCoinBalance: coinBalance,
    alreadyInGuild,
  };
}

export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const { searchParams } = new URL(req.url);

    if (searchParams.get("eligibility") === "true") {
      const eligibility = await getCreateEligibility(auth.user.sub);
      return NextResponse.json({ success: true, data: eligibility, error: null });
    }

    const city = searchParams.get("city");
    const tier = searchParams.get("tier");
    const openOnly = searchParams.get("open_only") === "true";
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20"), 50);
    const cursorParam = searchParams.get("cursor");

    // Decode cursor: base64-encoded JSON { created_at: string, id: string }
    // Guilds are ordered by guild_xp DESC then id DESC, but created_at + id
    // provides a stable cursor for discovery browsing (new guilds at the top).
    let cursorData: { created_at: string; id: string } | null = null;
    if (cursorParam) {
      try {
        cursorData = JSON.parse(Buffer.from(cursorParam, "base64").toString()) as {
          created_at: string;
          id: string;
        };
      } catch {
        // Invalid cursor — ignore and start from the beginning
      }
    }

    const orm = await getDb();
    const conditions = [eq(schema.guilds.isActive, true)];

    if (city) {
      conditions.push(ilike(schema.guilds.city, `%${city}%`));
    }
    if (tier) {
      conditions.push(eq(schema.guilds.tier, tier));
    }
    if (openOnly) {
      conditions.push(eq(schema.guilds.recruitmentType, "open"));
    }

    // Cursor condition: guilds with lower (created_at, id) than the cursor
    if (cursorData) {
      conditions.push(
        sql`(${schema.guilds.createdAt}, ${schema.guilds.id}) < (${cursorData.created_at}::timestamptz, ${cursorData.id}::uuid)`
      );
    }

    const result = await orm
      .select({
        id: schema.guilds.id,
        name: schema.guilds.name,
        crestEmoji: schema.guilds.crestEmoji,
        description: schema.guilds.description,
        city: schema.guilds.city,
        country: schema.guilds.country,
        captainId: schema.guilds.captainId,
        tier: schema.guilds.tier,
        guildXp: schema.guilds.guildXp,
        memberCount: schema.guilds.memberCount,
        treasuryBalance: schema.guilds.treasuryBalance,
        treasuryCap: schema.guilds.treasuryCap,
        recruitmentType: schema.guilds.recruitmentType,
        warsWon: schema.guilds.warsWon,
        warsLost: schema.guilds.warsLost,
        isActive: schema.guilds.isActive,
        createdAt: schema.guilds.createdAt,
      })
      .from(schema.guilds)
      .where(and(...conditions))
      .orderBy(desc(schema.guilds.guildXp), desc(schema.guilds.id))
      .limit(limit);

    // Produce the next cursor from the last item returned, if the page is full.
    const lastItem = result[result.length - 1];
    const nextCursor =
      lastItem && result.length === limit
        ? Buffer.from(
            JSON.stringify({
              created_at:
                lastItem.createdAt instanceof Date ? lastItem.createdAt.toISOString() : lastItem.createdAt,
              id: lastItem.id,
            })
          ).toString("base64")
        : null;

    return NextResponse.json({
      success: true,
      data: {
        items: result,
        hasMore: nextCursor !== null,
        nextCursor,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/guilds
// ---------------------------------------------------------------------------

/**
 * Create a new guild.
 * Atomically deducts 500 Coins from the creator and creates the guild
 * plus a guild_member record with the captain role.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const body = await validateBody(req, createGuildSchema);
    const userId = auth.user.sub;

    // Level gate: minimum account level required to found a guild (admin-configurable)
    const manifest = await loadManifest();
    const minLevel = manifest.guilds.minLevelToCreate;
    const orm = await getDb();
    const levelRow = await orm
      .select({ rankLevel: sql<number>`COALESCE(${schema.users.rankLevel}, 1)` })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    const currentLevel = levelRow[0]?.rankLevel ?? 1;
    if (currentLevel < minLevel) {
      throw forbidden(
        `Reach level ${minLevel} to found a guild. You are level ${currentLevel}.`,
        "GUILD_LEVEL_TOO_LOW",
        { minLevel, currentLevel }
      );
    }

    // Trust gate: guild_creation requires minimum trust score of 30
    const trusted = await meetsMinimumTrust(userId, "guild_creation", orm);
    if (!trusted) {
      throw forbidden("Your account trust score is too low to create a guild. Build your reputation first.", "GUILD_CREATION_TRUST_TOO_LOW");
    }

    const result = await orm.transaction(async (tx) => {
      // 1. Check user doesn't already belong to a guild
      const memberCheck = await tx
        .select({ guildId: schema.guildMembers.guildId })
        .from(schema.guildMembers)
        .where(eq(schema.guildMembers.userId, userId))
        .limit(1);
      if (memberCheck.length > 0) {
        throw badRequest("You already belong to a guild", "ALREADY_IN_GUILD");
      }

      // 2. Lock user row and check coin balance
      const userRows = await tx
        .select({ coinBalance: schema.users.coinBalance })
        .from(schema.users)
        .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
        .for("update");
      if (!userRows[0]) throw badRequest("User not found");

      const coinBalance = Number(userRows[0].coinBalance);
      if (coinBalance < GUILD_CREATION_COST_COINS) {
        throw forbidden(
          `Insufficient coins. Guild creation costs ${GUILD_CREATION_COST_COINS} coins.`,
          "INSUFFICIENT_COINS",
          { cost: GUILD_CREATION_COST_COINS, balance: coinBalance }
        );
      }

      // 3. Deduct coins from user
      const newBalance = coinBalance - GUILD_CREATION_COST_COINS;
      await tx
        .update(schema.users)
        .set({ coinBalance: BigInt(newBalance), updatedAt: sql`NOW()` })
        .where(eq(schema.users.id, userId));

      // 4. Record coin transaction in ledger
      await tx.insert(schema.coinLedger).values({
        userId,
        amount: BigInt(-GUILD_CREATION_COST_COINS),
        balanceBefore: BigInt(coinBalance),
        balanceAfter: BigInt(newBalance),
        transactionType: "guild_creation",
        description: "Guild creation fee",
      });

      // 5. Create guild
      const guildResult = await tx
        .insert(schema.guilds)
        .values({
          name: body.name,
          crestEmoji: body.crestEmoji,
          description: body.description ?? null,
          city: body.city ?? null,
          country: body.country,
          captainId: userId,
          tier: "bronze_1",
          guildXp: BigInt(0),
          memberCount: 1,
          treasuryBalance: BigInt(0),
          treasuryCap: BigInt(10000),
          recruitmentType: body.recruitmentType,
          warsWon: 0,
          warsLost: 0,
          isActive: true,
        })
        .returning({ id: schema.guilds.id });

      const guildId = guildResult[0].id;

      // 6. Create captain guild_member record
      await tx.insert(schema.guildMembers).values({
        guildId,
        userId,
        role: "captain",
        contributionScore: 0,
        warPointsTotal: 0,
      });

      // 7. Update user's guild_id
      await tx
        .update(schema.users)
        .set({ guildId, updatedAt: sql`NOW()` })
        .where(eq(schema.users.id, userId));

      return { guildId, coinsDeducted: GUILD_CREATION_COST_COINS, newCoinBalance: newBalance };
    });

    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
