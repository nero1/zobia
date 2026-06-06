/**
 * app/api/creator/sponsored-quests/[questId]/approve/route.ts
 *
 * POST /api/creator/sponsored-quests/[questId]/approve
 *
 * Admin approves (or rejects) a creator's completed sponsored quest and
 * triggers the coin payout.
 *
 * PRD §14 — Revenue split: 70% to creator, 30% to platform.
 *
 * Body: { applicationId, action: 'approve' | 'reject', rejectionReason? }
 *
 * On approval:
 *  1. Calculate creator share: rewardAmountCoins × creatorSharePercent / 100
 *  2. Credit coins to creator atomically.
 *  3. Record coin_ledger entry.
 *  4. Mark application as 'paid'.
 *  5. Notify creator.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const approveSchema = z.object({
  applicationId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  rejectionReason: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, approveSchema);

    // Fetch application
    const { rows: appRows } = await db.query<{
      id: string;
      creator_id: string;
      quest_id: string;
      status: string;
    }>(
      `SELECT id, creator_id, quest_id, status
       FROM sponsored_quest_applications
       WHERE id = $1 LIMIT 1`,
      [body.applicationId]
    );
    const app = appRows[0];
    if (!app) throw notFound("Application not found");
    if (app.status !== "completed") {
      throw badRequest(`Cannot ${body.action} application in '${app.status}' status`);
    }

    if (body.action === "reject") {
      await db.query(
        `UPDATE sponsored_quest_applications
         SET status = 'rejected', updated_at = NOW()
         WHERE id = $1`,
        [body.applicationId]
      );

      // Notify creator of rejection
      db.query(
        `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
         VALUES ($1, 'sponsored_quest_rejected', $2::jsonb, FALSE, NOW())`,
        [app.creator_id, JSON.stringify({
          questId: app.quest_id,
          applicationId: app.id,
          reason: body.rejectionReason ?? null,
        })]
      ).catch(() => {});

      return NextResponse.json({
        success: true,
        data: { applicationId: app.id, status: "rejected" },
        error: null,
      });
    }

    // APPROVE: calculate and credit payout
    const { rows: questRows } = await db.query<{
      id: string;
      title: string;
      reward_amount_coins: number;
      creator_share_percent: number;
    }>(
      `SELECT id, title, reward_amount_coins, creator_share_percent
       FROM sponsored_quests WHERE id = $1 LIMIT 1`,
      [app.quest_id]
    );
    const quest = questRows[0];
    if (!quest) throw notFound("Quest not found");

    const payoutCoins = Math.floor(
      quest.reward_amount_coins * (quest.creator_share_percent / 100)
    );

    await db.transaction(async (tx) => {
      // Lock creator row
      const { rows: creatorRows } = await tx.query<{ coin_balance: number }>(
        `SELECT coin_balance FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [app.creator_id]
      );
      if (!creatorRows[0]) throw new Error("Creator not found");

      const before = creatorRows[0].coin_balance;
      const after = before + payoutCoins;

      // Credit coins
      await tx.query(
        `UPDATE users SET coin_balance = $1, updated_at = NOW() WHERE id = $2`,
        [after, app.creator_id]
      );

      // Ledger entry
      await tx.query(
        `INSERT INTO coin_ledger
           (user_id, amount, balance_before, balance_after, transaction_type,
            reference_id, description, created_at)
         VALUES ($1, $2, $3, $4, 'sponsored_quest_payout', $5,
                 $6, NOW())`,
        [
          app.creator_id,
          payoutCoins,
          before,
          after,
          app.quest_id,
          `Sponsored quest payout: ${quest.title}`,
        ]
      );

      // Record creator earnings (coins → kobo: 1 coin = 100 kobo)
      const grossKobo = quest.reward_amount_coins * 100;
      const netKobo = payoutCoins * 100;
      const platformFeeKobo = grossKobo - netKobo;
      await tx.query(
        `INSERT INTO creator_earnings
           (creator_id, source_type, gross_amount_kobo, platform_fee_kobo, net_amount_kobo,
            reference_id, created_at)
         VALUES ($1, 'sponsored_quest', $2, $3, $4, $5, NOW())`,
        [app.creator_id, grossKobo, platformFeeKobo, netKobo, app.id]
      );

      // Mark application as paid
      await tx.query(
        `UPDATE sponsored_quest_applications
         SET status = 'paid',
             payout_coins = $1,
             approved_at  = NOW(),
             paid_at      = NOW(),
             updated_at   = NOW()
         WHERE id = $2`,
        [payoutCoins, app.id]
      );

      // Notify creator
      await tx.query(
        `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
         VALUES ($1, 'sponsored_quest_paid', $2::jsonb, FALSE, NOW())`,
        [app.creator_id, JSON.stringify({
          questId: app.quest_id,
          questTitle: quest.title,
          payoutCoins,
          applicationId: app.id,
        })]
      ).catch(() => {});
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          applicationId: app.id,
          status: "paid",
          payoutCoins,
          creatorId: app.creator_id,
          message: `${payoutCoins} coins credited to creator.`,
        },
        error: null,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
