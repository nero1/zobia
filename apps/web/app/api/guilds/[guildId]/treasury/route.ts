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
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
      const orm = await getDb();

      // Verify member access
      const memberCheck = await orm
        .select({ id: schema.guildMembers.id })
        .from(schema.guildMembers)
        .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, auth.user.sub)))
        .limit(1);
      if (!memberCheck[0]) throw forbidden("You are not a member of this guild");

      const guildResult = await orm
        .select({
          id: schema.guilds.id,
          treasuryBalance: schema.guilds.treasuryBalance,
          treasuryCap: schema.guilds.treasuryCap,
          captainId: schema.guilds.captainId,
        })
        .from(schema.guilds)
        .where(and(eq(schema.guilds.id, guildId), eq(schema.guilds.isActive, true)))
        .limit(1);
      if (!guildResult[0]) throw notFound("Guild not found");
      const guild = guildResult[0];

      const txResult = await orm
        .select({
          id: schema.guildTreasuryLedger.id,
          guildId: schema.guildTreasuryLedger.guildId,
          userId: schema.guildTreasuryLedger.userId,
          amount: schema.guildTreasuryLedger.amount,
          balanceBefore: schema.guildTreasuryLedger.balanceBefore,
          balanceAfter: schema.guildTreasuryLedger.balanceAfter,
          transactionType: schema.guildTreasuryLedger.transactionType,
          description: schema.guildTreasuryLedger.description,
          createdAt: schema.guildTreasuryLedger.createdAt,
          username: schema.users.username,
        })
        .from(schema.guildTreasuryLedger)
        .leftJoin(schema.users, eq(schema.users.id, schema.guildTreasuryLedger.userId))
        .where(eq(schema.guildTreasuryLedger.guildId, guildId))
        .orderBy(desc(schema.guildTreasuryLedger.createdAt))
        .limit(50);

      return NextResponse.json({
        success: true,
        data: {
          balance: Number(guild.treasuryBalance),
          cap: Number(guild.treasuryCap),
          transactions: txResult,
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
      const orm = await getDb();

      if (action === "donate") {
        const body = await validateBody(req, donateSchema);

        const result = await orm.transaction(async (tx) => {
          // Lock user and guild
          const userRows = await tx
            .select({ coinBalance: schema.users.coinBalance, guildId: schema.users.guildId })
            .from(schema.users)
            .where(eq(schema.users.id, userId))
            .for("update");
          const userRow = userRows[0];
          if (!userRow) throw notFound("User not found");
          if (userRow.guildId !== guildId) {
            throw forbidden("You are not a member of this guild");
          }
          const coinBalanceBefore = Number(userRow.coinBalance);
          if (coinBalanceBefore < body.amount) {
            throw badRequest("Insufficient coins", "INSUFFICIENT_BALANCE");
          }

          const guildRows = await tx
            .select({
              id: schema.guilds.id,
              treasuryBalance: schema.guilds.treasuryBalance,
              treasuryCap: schema.guilds.treasuryCap,
            })
            .from(schema.guilds)
            .where(eq(schema.guilds.id, guildId))
            .for("update");
          const guild = guildRows[0];
          if (!guild) throw notFound("Guild not found");

          const treasuryBalanceBefore = Number(guild.treasuryBalance);
          const treasuryCap = Number(guild.treasuryCap);
          const newBalance = treasuryBalanceBefore + body.amount;
          if (newBalance > treasuryCap) {
            throw badRequest(
              `Donation would exceed treasury cap of ${treasuryCap}`,
              "TREASURY_CAP_EXCEEDED"
            );
          }

          // Deduct from user.
          // SYS-CL-04: each donation is its own transaction-specific reference (not the
          // bare guildId), so repeat donations to the same guild don't collide on the
          // coin_ledger unique index. ON CONFLICT DO NOTHING mirrors writeLedgerEntry's
          // idempotent-retry behavior in lib/economy/coins.ts.
          await tx
            .update(schema.users)
            .set({
              coinBalance: sql`${schema.users.coinBalance} - ${body.amount}`,
              updatedAt: sql`NOW()`,
            })
            .where(eq(schema.users.id, userId));
          await tx
            .insert(schema.coinLedger)
            .values({
              userId,
              amount: BigInt(-body.amount),
              balanceBefore: BigInt(coinBalanceBefore),
              balanceAfter: BigInt(coinBalanceBefore - body.amount),
              transactionType: "guild_donation",
              referenceId: `guild_donation:${guildId}:${userId}:${randomUUID()}`,
              description: body.note ?? "Guild treasury donation",
            })
            .onConflictDoNothing({
              target: [schema.coinLedger.userId, schema.coinLedger.transactionType, schema.coinLedger.referenceId],
            });

          // Add to treasury — LEAST clamp as a DB-level guard in case of races (#24)
          await tx
            .update(schema.guilds)
            .set({
              treasuryBalance: sql`LEAST(${schema.guilds.treasuryCap}, ${schema.guilds.treasuryBalance} + ${body.amount})`,
              updatedAt: sql`NOW()`,
            })
            .where(eq(schema.guilds.id, guildId));

          // Record treasury ledger entry
          await tx.insert(schema.guildTreasuryLedger).values({
            guildId,
            userId,
            amount: BigInt(body.amount),
            balanceBefore: BigInt(treasuryBalanceBefore),
            balanceAfter: BigInt(newBalance),
            transactionType: "donation",
            description: body.note ?? null,
          });

          // Update member contribution score
          await tx
            .update(schema.guildMembers)
            .set({ contributionScore: sql`${schema.guildMembers.contributionScore} + ${Math.floor(body.amount / 10)}` })
            .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, userId)));

          return { donated: body.amount, newTreasuryBalance: newBalance };
        });

        return NextResponse.json({ success: true, data: result, error: null });
      }

      if (action === "spend") {
        const body = await validateBody(req, spendSchema);

        const captainCheck = await orm
          .select({ captainId: schema.guilds.captainId, treasuryBalance: schema.guilds.treasuryBalance })
          .from(schema.guilds)
          .where(and(eq(schema.guilds.id, guildId), eq(schema.guilds.isActive, true)))
          .limit(1);
        if (!captainCheck[0]) throw notFound("Guild not found");
        if (captainCheck[0].captainId !== userId) {
          throw forbidden("Only the guild captain can spend treasury coins");
        }

        const treasuryBalance = Number(captainCheck[0].treasuryBalance);
        if (treasuryBalance < body.amount) {
          throw badRequest("Insufficient treasury balance", "INSUFFICIENT_TREASURY");
        }

        await orm.transaction(async (tx) => {
          await tx
            .update(schema.guilds)
            .set({
              treasuryBalance: sql`${schema.guilds.treasuryBalance} - ${body.amount}`,
              updatedAt: sql`NOW()`,
            })
            .where(eq(schema.guilds.id, guildId));

          await tx.insert(schema.guildTreasuryLedger).values({
            guildId,
            userId,
            amount: BigInt(-body.amount),
            balanceBefore: BigInt(treasuryBalance),
            balanceAfter: BigInt(treasuryBalance - body.amount),
            transactionType: "spend",
            description: body.reason,
          });
        });

        return NextResponse.json({
          success: true,
          data: { spent: body.amount, newTreasuryBalance: treasuryBalance - body.amount },
          error: null,
        });
      }

      throw badRequest("Unknown treasury action");
    } catch (err) {
      return handleApiError(err);
    }
  }
);
