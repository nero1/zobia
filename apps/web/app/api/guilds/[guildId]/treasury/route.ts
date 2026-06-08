export const dynamic = 'force-dynamic';

/**
 * app/api/guilds/[guildId]/treasury/route.ts
 *
 * Guild treasury endpoints.
 *
 * GET  /api/guilds/[guildId]/treasury
 *   - Returns treasury balance and recent transaction history (last 50 entries).
 *
 * POST /api/guilds/[guildId]/treasury/donate
 *   - Donate coins from a member's personal balance to the guild treasury.
 *   - Voluntary; any guild member can donate.
 *
 * POST /api/guilds/[guildId]/treasury/spend
 *   - Spend treasury coins for guild upgrades / rewards (captain only).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const donateSchema = z.object({
  amount: z.number().int().positive().max(100_000),
  note: z.string().max(200).optional(),
});

const spendSchema = z.object({
  amount: z.number().int().positive(),
  reason: z.string().min(3).max(200),
});

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface TreasuryRow {
  id: string;
  treasury_balance: number;
  treasury_cap: number;
  captain_id: string;
}

interface TreasuryTxRow {
  id: string;
  guild_id: string;
  user_id: string | null;
  amount: number;
  balance_before: number;
  balance_after: number;
  transaction_type: string;
  description: string | null;
  created_at: string;
  username: string | null;
}

// ---------------------------------------------------------------------------
// GET /api/guilds/[guildId]/treasury
// ---------------------------------------------------------------------------

/**
 * Fetch the guild treasury balance and the last 50 transactions.
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { guildId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { guildId } = params;

      // Verify member access
      const memberCheck = await db.query<{ id: string }>(
        `SELECT id FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
        [guildId, auth.user.sub]
      );
      if (!memberCheck.rows[0]) throw forbidden("You are not a member of this guild");

      const guildResult = await db.query<TreasuryRow>(
        `SELECT id, treasury_balance, treasury_cap, captain_id
         FROM guilds WHERE id = $1 AND is_active = TRUE`,
        [guildId]
      );
      if (!guildResult.rows[0]) throw notFound("Guild not found");
      const guild = guildResult.rows[0];

      const txResult = await db.query<TreasuryTxRow>(
        `SELECT gt.id, gt.guild_id, gt.user_id, gt.amount, gt.balance_before,
                gt.balance_after, gt.transaction_type, gt.description, gt.created_at,
                u.username
         FROM guild_treasury_ledger gt
         LEFT JOIN users u ON u.id = gt.user_id
         WHERE gt.guild_id = $1
         ORDER BY gt.created_at DESC
         LIMIT 50`,
        [guildId]
      );

      return NextResponse.json({
        success: true,
        data: {
          balance: guild.treasury_balance,
          cap: guild.treasury_cap,
          transactions: txResult.rows,
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/guilds/[guildId]/treasury/donate
// ---------------------------------------------------------------------------

/**
 * Donate coins from the calling user's personal balance to the guild treasury.
 * Respects the guild's treasury cap.
 */
export const POST = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { guildId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { guildId } = params;
      const userId = auth.user.sub;

      // Check route action via URL segment
      const url = new URL(req.url);
      const action = url.pathname.split("/").at(-1); // 'donate' or 'spend'

      if (action === "donate") {
        const body = await validateBody(req, donateSchema);

        const result = await db.transaction(async (client) => {
          // Lock user and guild
          const userRow = await client.query<{
            coin_balance: number;
            guild_id: string | null;
          }>(
            `SELECT coin_balance, guild_id FROM users WHERE id = $1 FOR UPDATE`,
            [userId]
          );
          if (!userRow.rows[0]) throw notFound("User not found");
          if (userRow.rows[0].guild_id !== guildId) {
            throw forbidden("You are not a member of this guild");
          }
          if (userRow.rows[0].coin_balance < body.amount) {
            throw badRequest("Insufficient coins", "INSUFFICIENT_BALANCE");
          }

          const guildRow = await client.query<TreasuryRow>(
            `SELECT id, treasury_balance, treasury_cap FROM guilds WHERE id = $1 FOR UPDATE`,
            [guildId]
          );
          const guild = guildRow.rows[0];
          if (!guild) throw notFound("Guild not found");

          const newBalance = guild.treasury_balance + body.amount;
          if (newBalance > guild.treasury_cap) {
            throw badRequest(
              `Donation would exceed treasury cap of ${guild.treasury_cap}`,
              "TREASURY_CAP_EXCEEDED"
            );
          }

          // Deduct from user
          await client.query(
            `UPDATE users SET coin_balance = coin_balance - $1, updated_at = NOW() WHERE id = $2`,
            [body.amount, userId]
          );
          await client.query(
            `INSERT INTO coin_ledger (user_id, amount, balance_before, balance_after, transaction_type, reference_id, description, created_at)
             VALUES ($1, $2, $3, $4, 'guild_donation', $5, $6, NOW())`,
            [
              userId,
              -body.amount,
              userRow.rows[0].coin_balance,
              userRow.rows[0].coin_balance - body.amount,
              guildId,
              body.note ?? "Guild treasury donation",
            ]
          );

          // Add to treasury
          await client.query(
            `UPDATE guilds SET treasury_balance = treasury_balance + $1, updated_at = NOW()
             WHERE id = $2`,
            [body.amount, guildId]
          );

          // Record treasury ledger entry
          await client.query(
            `INSERT INTO guild_treasury_ledger (guild_id, user_id, amount, balance_before, balance_after, transaction_type, description, created_at)
             VALUES ($1, $2, $3, $4, $5, 'donation', $6, NOW())`,
            [
              guildId,
              userId,
              body.amount,
              guild.treasury_balance,
              newBalance,
              body.note ?? null,
            ]
          );

          // Update member contribution score
          await client.query(
            `UPDATE guild_members SET contribution_score = contribution_score + $1
             WHERE guild_id = $2 AND user_id = $3`,
            [Math.floor(body.amount / 10), guildId, userId]
          );

          return { donated: body.amount, newTreasuryBalance: newBalance };
        });

        return NextResponse.json({ success: true, data: result, error: null });
      }

      if (action === "spend") {
        const body = await validateBody(req, spendSchema);

        const captainCheck = await db.query<{ captain_id: string; treasury_balance: number }>(
          `SELECT captain_id, treasury_balance FROM guilds WHERE id = $1 AND is_active = TRUE`,
          [guildId]
        );
        if (!captainCheck.rows[0]) throw notFound("Guild not found");
        if (captainCheck.rows[0].captain_id !== userId) {
          throw forbidden("Only the guild captain can spend treasury coins");
        }

        const { treasury_balance } = captainCheck.rows[0];
        if (treasury_balance < body.amount) {
          throw badRequest("Insufficient treasury balance", "INSUFFICIENT_TREASURY");
        }

        await db.transaction(async (client) => {
          await client.query(
            `UPDATE guilds SET treasury_balance = treasury_balance - $1, updated_at = NOW()
             WHERE id = $2`,
            [body.amount, guildId]
          );

          await client.query(
            `INSERT INTO guild_treasury_ledger (guild_id, user_id, amount, balance_before, balance_after, transaction_type, description, created_at)
             VALUES ($1, $2, $3, $4, $5, 'spend', $6, NOW())`,
            [
              guildId,
              userId,
              -body.amount,
              treasury_balance,
              treasury_balance - body.amount,
              body.reason,
            ]
          );
        });

        return NextResponse.json({
          success: true,
          data: { spent: body.amount, newTreasuryBalance: treasury_balance - body.amount },
          error: null,
        });
      }

      throw badRequest("Unknown treasury action");
    } catch (err) {
      return handleApiError(err);
    }
  }
);
