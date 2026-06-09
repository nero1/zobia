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
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden } from "@/lib/api/errors";
import { meetsMinimumTrust } from "@/lib/trust/trustScore";

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

interface GuildRow {
  id: string;
  name: string;
  crest_emoji: string;
  description: string | null;
  city: string | null;
  country: string;
  captain_id: string;
  tier: string;
  guild_xp: number;
  member_count: number;
  treasury_balance: number;
  treasury_cap: number;
  recruitment_type: string;
  wars_won: number;
  wars_lost: number;
  is_active: boolean;
  created_at: string;
}

/**
 * Browse guilds with optional filters.
 * Supports city, tier, and open_only query params.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const { searchParams } = new URL(req.url);
    const city = searchParams.get("city");
    const tier = searchParams.get("tier");
    const openOnly = searchParams.get("open_only") === "true";
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20"), 50);
    const offset = parseInt(searchParams.get("offset") ?? "0");

    const conditions: string[] = ["g.is_active = TRUE"];
    const params: (string | number | boolean)[] = [];
    let paramIdx = 1;

    if (city) {
      conditions.push(`g.city ILIKE $${paramIdx++}`);
      params.push(`%${city}%`);
    }
    if (tier) {
      conditions.push(`g.tier = $${paramIdx++}`);
      params.push(tier);
    }
    if (openOnly) {
      conditions.push(`g.recruitment_type = 'open'`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await db.query<GuildRow>(
      `SELECT g.id, g.name, g.crest_emoji, g.description, g.city, g.country,
              g.captain_id, g.tier, g.guild_xp, g.member_count, g.treasury_balance,
              g.treasury_cap, g.recruitment_type, g.wars_won, g.wars_lost,
              g.is_active, g.created_at
       FROM guilds g
       ${whereClause}
       ORDER BY g.guild_xp DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM guilds g ${whereClause}`,
      params
    );

    return NextResponse.json({
      success: true,
      data: {
        items: result.rows,
        total: parseInt(countResult.rows[0]?.count ?? "0"),
        hasMore: offset + limit < parseInt(countResult.rows[0]?.count ?? "0"),
        nextCursor: null,
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

    // Trust gate: guild_creation requires minimum trust score of 30
    const trusted = await meetsMinimumTrust(userId, "guild_creation", db);
    if (!trusted) {
      throw forbidden("Your account trust score is too low to create a guild. Build your reputation first.", "TRUST_SCORE_TOO_LOW");
    }

    const result = await db.transaction(async (client) => {
      // 1. Check user doesn't already belong to a guild
      const memberCheck = await client.query<{ guild_id: string }>(
        `SELECT guild_id FROM guild_members WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      if (memberCheck.rows.length > 0) {
        throw badRequest("You already belong to a guild", "ALREADY_IN_GUILD");
      }

      // 2. Lock user row and check coin balance
      const userRow = await client.query<{ coin_balance: number }>(
        `SELECT coin_balance FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [userId]
      );
      if (!userRow.rows[0]) throw badRequest("User not found");

      const { coin_balance } = userRow.rows[0];
      if (coin_balance < GUILD_CREATION_COST_COINS) {
        throw forbidden(`Insufficient coins. Guild creation costs ${GUILD_CREATION_COST_COINS} coins.`);
      }

      // 3. Deduct coins from user
      const newBalance = coin_balance - GUILD_CREATION_COST_COINS;
      await client.query(
        `UPDATE users SET coin_balance = $1, updated_at = NOW() WHERE id = $2`,
        [newBalance, userId]
      );

      // 4. Record coin transaction in ledger
      await client.query(
        `INSERT INTO coin_ledger (user_id, amount, balance_before, balance_after, transaction_type, description, created_at)
         VALUES ($1, $2, $3, $4, 'guild_creation', 'Guild creation fee', NOW())`,
        [userId, -GUILD_CREATION_COST_COINS, coin_balance, newBalance]
      );

      // 5. Create guild
      const guildResult = await client.query<{ id: string }>(
        `INSERT INTO guilds (name, crest_emoji, description, city, country, captain_id,
                             tier, guild_xp, member_count, treasury_balance, treasury_cap,
                             recruitment_type, wars_won, wars_lost, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6,
                 'bronze_1', 0, 1, 0, 10000,
                 $7, 0, 0, TRUE, NOW(), NOW())
         RETURNING id`,
        [
          body.name,
          body.crestEmoji,
          body.description ?? null,
          body.city ?? null,
          body.country,
          userId,
          body.recruitmentType,
        ]
      );

      const guildId = guildResult.rows[0].id;

      // 6. Create captain guild_member record
      await client.query(
        `INSERT INTO guild_members (guild_id, user_id, role, contribution_score, war_points_total, joined_at)
         VALUES ($1, $2, 'captain', 0, 0, NOW())`,
        [guildId, userId]
      );

      // 7. Update user's guild_id
      await client.query(
        `UPDATE users SET guild_id = $1, updated_at = NOW() WHERE id = $2`,
        [guildId, userId]
      );

      return { guildId, coinsDeducted: GUILD_CREATION_COST_COINS, newCoinBalance: newBalance };
    });

    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
