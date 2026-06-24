export const dynamic = 'force-dynamic';

/**
 * app/api/guilds/[guildId]/wars/route.ts
 *
 * Guild war endpoints for a specific guild.
 *
 * GET  /api/guilds/[guildId]/wars
 *   - Returns paginated war history for the guild.
 *
 * POST /api/guilds/[guildId]/wars
 *   - Declare war on a suitable opponent (captain only).
 *   - Finds opponent within ±15% of the guild's XP.
 *   - Enforces a 72-hour cooldown between wars.
 *   - Creates guild_wars record with 48-hour duration.
 *   - Sets final_hour_starts_at to 47 hours in (last 60 minutes = Final Hour).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { withAuth } from "@/lib/api/middleware";
import { requireFeatureEnabled, loadManifest } from "@/lib/manifest";
import { handleApiError, badRequest, forbidden, notFound, conflict } from "@/lib/api/errors";
import {
  findWarOpponent,
  WAR_DURATION_HOURS,
  WAR_ENTRY_FEE_COINS,
  getRematchDiscount,
} from "@/lib/guilds/warEngine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** War starts immediately on declaration. */
const WAR_START_OFFSET_MS = 0;

/** Final Hour begins 60 minutes before the end of the 48-hour war. */
const FINAL_HOUR_OFFSET_MINUTES = 60;

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface WarRow {
  id: string;
  challenger_guild_id: string;
  defender_guild_id: string;
  status: string;
  challenger_points: number;
  defender_points: number;
  winner_guild_id: string | null;
  starts_at: string;
  ends_at: string;
  final_hour_starts_at: string;
  created_at: string;
  challenger_name: string;
  challenger_crest: string;
  defender_name: string;
  defender_crest: string;
}

// ---------------------------------------------------------------------------
// GET /api/guilds/[guildId]/wars
// ---------------------------------------------------------------------------

/**
 * Fetch war history for this guild (most recent first, paginated).
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    { params }: { params: { guildId: string } }
  ) => {
    try {
      const { guildId } = params;
      const { searchParams } = new URL(req.url);
      const limit = Math.min(parseInt(searchParams.get("limit") ?? "20"), 50);
      const offset = parseInt(searchParams.get("offset") ?? "0");

      const guildExists = await db.query<{ id: string }>(
        `SELECT id FROM guilds WHERE id = $1 AND is_active = TRUE`,
        [guildId]
      );
      if (!guildExists.rows[0]) throw notFound("Guild not found");

      const { rows } = await db.query<WarRow>(
        `SELECT
           gw.id, gw.challenger_guild_id, gw.defender_guild_id, gw.status,
           gw.challenger_points, gw.defender_points, gw.winner_guild_id,
           gw.starts_at, gw.ends_at, gw.final_hour_starts_at, gw.created_at,
           cg.name AS challenger_name, cg.crest_emoji AS challenger_crest,
           dg.name AS defender_name, dg.crest_emoji AS defender_crest
         FROM guild_wars gw
         JOIN guilds cg ON cg.id = gw.challenger_guild_id
         JOIN guilds dg ON dg.id = gw.defender_guild_id
         WHERE gw.challenger_guild_id = $1 OR gw.defender_guild_id = $1
         ORDER BY gw.created_at DESC
         LIMIT $2 OFFSET $3`,
        [guildId, limit, offset]
      );

      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM guild_wars
         WHERE challenger_guild_id = $1 OR defender_guild_id = $1`,
        [guildId]
      );

      return NextResponse.json({
        success: true,
        data: {
          wars: rows,
          total: parseInt(countResult.rows[0]?.count ?? "0"),
          hasMore: offset + limit < parseInt(countResult.rows[0]?.count ?? "0"),
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/guilds/[guildId]/wars
// ---------------------------------------------------------------------------

/**
 * Declare war on a suitable opponent (captain only).
 *
 * Checks:
 *  1. Caller is the guild captain.
 *  2. Guild is not already in an active war.
 *  3. Guild has passed the 72-hour cooldown since its last war ended.
 *  4. A suitable opponent (within ±15% XP) can be found.
 */
export const POST = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { guildId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      await requireFeatureEnabled("guildWars");
      const { guildId } = params;
      const userId = auth.user.sub;

      const manifest = await loadManifest();
      const effectiveCooldownHours = manifest.warEventCooldownHours;

      // Check for an active rematch token before entering the transaction
      // (read-only; token is consumed atomically inside the transaction)
      const rematchDiscountPercent = await getRematchDiscount(guildId, db);
      const effectiveFee = Math.floor(
        WAR_ENTRY_FEE_COINS * (1 - rematchDiscountPercent / 100)
      );

      // Find opponent BEFORE the outer transaction. findWarOpponent opens its
      // own db.transaction() on a separate connection; nesting it inside the
      // outer transaction would put the FOR UPDATE SKIP LOCKED lock on a
      // different connection than the war INSERT, breaking lock atomicity.
      // The Redis opponent lock (acquired immediately below) covers the window
      // between the SELECT and the war INSERT.
      const opponentId = await findWarOpponent(guildId, db);
      if (!opponentId) {
        throw badRequest(
          "No suitable opponent found. Try again later.",
          "NO_OPPONENT_FOUND"
        );
      }

      // Acquire a short-lived Redis distributed lock on the opponent guild so two
      // concurrent declarations cannot claim the same defender between SELECT and INSERT.
      // The unique partial index on guild_wars(defender_guild_id) is the DB-level fallback.
      const opponentLockKey = `war:lock:opponent:${opponentId}`;
      const lockAcquired = await redis.set(opponentLockKey, "1", "EX", 30, "NX");
      if (!lockAcquired) {
        throw conflict(
          "This opponent guild was just claimed by another declaration. Please try again.",
          "OPPONENT_CLAIMED"
        );
      }

      let result: {
        warId: string;
        challengerGuildId: string;
        defenderGuildId: string;
        startsAt: string;
        endsAt: string;
        finalHourStartsAt: string;
        entryFeePaid: number;
        rematchDiscountApplied: boolean;
      };
      try {
        result = await db.transaction(async (client) => {
          // BUG-012 FIX: acquire a PostgreSQL advisory transaction lock on the
          // declaring guild before any DML so only one concurrent war declaration
          // per guild can proceed at a time. pg_try_advisory_xact_lock uses an
          // integer key — we hash the UUID to a stable bigint.
          const lockResult = await client.query<{ acquired: boolean }>(
            `SELECT pg_try_advisory_xact_lock(
               ('x' || substr(md5($1), 1, 16))::bit(64)::bigint
             ) AS acquired`,
            [guildId]
          );
          if (!lockResult.rows[0]?.acquired) {
            throw conflict(
              "Another war declaration is already in progress for this guild. Please try again.",
              "CONCURRENT_WAR_DECLARATION"
            );
          }

          // 1. Verify caller is captain and lock guild row
          const guildRow = await client.query<{
            captain_id: string;
            last_war_ended_at: string | null;
            guild_xp: number;
            treasury_balance: number;
          }>(
            `SELECT captain_id, last_war_ended_at, guild_xp, treasury_balance
             FROM guilds WHERE id = $1 AND is_active = TRUE FOR UPDATE`,
            [guildId]
          );
          if (!guildRow.rows[0]) throw notFound("Guild not found");
          if (guildRow.rows[0].captain_id !== userId) {
            throw forbidden("Only the guild captain can declare war");
          }

          // 2. Check treasury covers the entry fee
          if (guildRow.rows[0].treasury_balance < effectiveFee) {
            throw badRequest(
              `Insufficient guild treasury. ${effectiveFee} coins required (current: ${guildRow.rows[0].treasury_balance}).`,
              "INSUFFICIENT_TREASURY"
            );
          }

          // 3. Check existing active war
          const activeWar = await client.query<{ id: string }>(
            `SELECT id FROM guild_wars
             WHERE (challenger_guild_id = $1 OR defender_guild_id = $1)
               AND status IN ('active', 'final_hour')
             LIMIT 1`,
            [guildId]
          );
          if (activeWar.rows.length > 0) {
            throw conflict("Guild is already in an active war", "WAR_ALREADY_ACTIVE");
          }

          // BUG-RACE-01: Re-verify opponent availability inside the transaction.
          // Lock the opponent guild row with SKIP LOCKED so concurrent war declarations
          // targeting the same opponent cannot both succeed — the second caller will
          // get no rows back and throw OPPONENT_UNAVAILABLE rather than inserting a
          // duplicate war record that would violate the defender unique partial index.
          const opponentAvailable = await client.query<{ id: string }>(
            `SELECT g.id FROM guilds g
             WHERE g.id = $1
               AND g.is_active = TRUE
               AND NOT EXISTS (
                 SELECT 1 FROM guild_wars gw
                 WHERE (gw.challenger_guild_id = $1 OR gw.defender_guild_id = $1)
                   AND gw.status IN ('active', 'final_hour')
               )
             FOR UPDATE SKIP LOCKED`,
            [opponentId]
          );
          if (!opponentAvailable.rows[0]) {
            throw conflict(
              "Opponent guild is no longer available for war. Please try again.",
              "OPPONENT_UNAVAILABLE"
            );
          }

          // 4. Check cooldown (duration is 48h during a War Event, 72h otherwise)
          const { last_war_ended_at } = guildRow.rows[0];
          if (last_war_ended_at) {
            const cooldownEnd =
              new Date(last_war_ended_at).getTime() + effectiveCooldownHours * 60 * 60 * 1000;
            if (Date.now() < cooldownEnd) {
              const hoursRemaining = Math.ceil((cooldownEnd - Date.now()) / (60 * 60 * 1000));
              throw badRequest(
                `War cooldown active. ${hoursRemaining} hour(s) remaining.`,
                "WAR_COOLDOWN_ACTIVE"
              );
            }
          }

          // 5. Deduct entry fee from guild treasury
          if (effectiveFee > 0) {
            await client.query(
              `UPDATE guilds SET treasury_balance = treasury_balance - $1, updated_at = NOW()
               WHERE id = $2`,
              [effectiveFee, guildId]
            );
          }

          // 6. Consume rematch token if one was used (atomic, inside same transaction)
          if (rematchDiscountPercent > 0) {
            await client.query(
              `UPDATE guild_war_rematch_tokens
               SET is_used = true
               WHERE id = (
                 SELECT id FROM guild_war_rematch_tokens
                 WHERE guild_id = $1 AND is_used = false AND expires_at > NOW()
                 ORDER BY created_at ASC
                 LIMIT 1
               )`,
              [guildId]
            );
          }

          // 7. Create war record
          const startsAt = new Date(Date.now() + WAR_START_OFFSET_MS);
          const endsAt = new Date(
            startsAt.getTime() + WAR_DURATION_HOURS * 60 * 60 * 1000
          );
          const finalHourStartsAt = new Date(
            endsAt.getTime() - FINAL_HOUR_OFFSET_MINUTES * 60 * 1000
          );

          const warResult = await client.query<{ id: string }>(
            `INSERT INTO guild_wars
               (challenger_guild_id, defender_guild_id, status,
                challenger_points, defender_points, winner_guild_id,
                starts_at, ends_at, final_hour_starts_at, created_at, updated_at)
             VALUES ($1, $2, 'active', 0, 0, NULL, $3, $4, $5, NOW(), NOW())
             RETURNING id`,
            [guildId, opponentId, startsAt.toISOString(), endsAt.toISOString(), finalHourStartsAt.toISOString()]
          );

          const warId = warResult.rows[0].id;

          return {
            warId,
            challengerGuildId: guildId,
            defenderGuildId: opponentId,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            finalHourStartsAt: finalHourStartsAt.toISOString(),
            entryFeePaid: effectiveFee,
            rematchDiscountApplied: rematchDiscountPercent > 0,
          };
        });
      } finally {
        // Release the opponent lock — TTL handles cleanup if this call fails
        await redis.del(opponentLockKey).catch(() => {});
      }

      return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
