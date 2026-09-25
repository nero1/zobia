export const dynamic = 'force-dynamic';

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
 *  1. Calculate creator share: rewardCoins × creatorSharePercent / 100
 *  2. Credit coins to creator atomically.
 *  3. Record coin_ledger entry.
 *  4. Mark application as 'paid'.
 *  5. Notify creator.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { insertNotification } from "@/lib/notifications/insert";
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

export const POST = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, approveSchema);

    const orm = await getDb();

    // Fetch application
    const appRows = await orm
      .select({
        id: schema.sponsoredQuestApplications.id,
        creatorId: schema.sponsoredQuestApplications.creatorId,
        questId: schema.sponsoredQuestApplications.questId,
        status: schema.sponsoredQuestApplications.status,
      })
      .from(schema.sponsoredQuestApplications)
      .where(eq(schema.sponsoredQuestApplications.id, body.applicationId))
      .limit(1);
    const app = appRows[0];
    if (!app) throw notFound("Application not found");
    if (app.status !== "completed") {
      throw badRequest(`Cannot ${body.action} application in '${app.status}' status`);
    }

    if (body.action === "reject") {
      await orm
        .update(schema.sponsoredQuestApplications)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(eq(schema.sponsoredQuestApplications.id, body.applicationId));

      // Notify creator of rejection
      insertNotification(
        orm,
        app.creatorId,
        "sponsored_quest_rejected",
        "Sponsored quest application rejected",
        `Your sponsored quest application was not approved.${body.rejectionReason ? ` Reason: ${body.rejectionReason}` : ""}`,
        { questId: app.questId, applicationId: app.id, reason: body.rejectionReason ?? null }
      ).catch(() => {});

      return NextResponse.json({
        success: true,
        data: { applicationId: app.id, status: "rejected" },
        error: null,
      });
    }

    // APPROVE: calculate and credit payout
    const questRows = await orm
      .select({
        id: schema.sponsoredQuests.id,
        title: schema.sponsoredQuests.title,
        rewardCoins: schema.sponsoredQuests.rewardCoins,
        creatorSharePercent: schema.sponsoredQuests.creatorSharePercent,
      })
      .from(schema.sponsoredQuests)
      .where(eq(schema.sponsoredQuests.id, app.questId))
      .limit(1);
    const quest = questRows[0];
    if (!quest) throw notFound("Quest not found");

    const rewardCoins = quest.rewardCoins ?? 0;
    const payoutCoins = Math.floor(rewardCoins * (quest.creatorSharePercent / 100));

    await orm.transaction(async (tx) => {
      // Lock creator row
      const creatorRows = await tx
        .select({ coinBalance: schema.users.coinBalance })
        .from(schema.users)
        .where(and(eq(schema.users.id, app.creatorId), isNull(schema.users.deletedAt)))
        .for("update");
      if (!creatorRows[0]) throw new Error("Creator not found");

      const before = creatorRows[0].coinBalance;
      const after = before + BigInt(payoutCoins);

      // Credit coins
      await tx.update(schema.users).set({ coinBalance: after, updatedAt: new Date() }).where(eq(schema.users.id, app.creatorId));

      // Ledger entry
      await tx.insert(schema.coinLedger).values({
        userId: app.creatorId,
        amount: BigInt(payoutCoins),
        balanceBefore: before,
        balanceAfter: after,
        transactionType: "sponsored_quest_payout",
        referenceId: app.questId,
        description: `Sponsored quest payout: ${quest.title}`,
      });

      // Record creator earnings (coins → kobo: 1 coin = 100 kobo)
      const grossKobo = BigInt(rewardCoins) * BigInt(100);
      const netKobo = BigInt(payoutCoins) * BigInt(100);
      const platformFeeKobo = grossKobo - netKobo;
      await tx.insert(schema.creatorEarnings).values({
        creatorId: app.creatorId,
        sourceType: "sponsored_quest",
        grossAmountKobo: grossKobo,
        platformFeeKobo,
        netAmountKobo: netKobo,
        referenceId: app.id,
      });

      // Mark application as paid
      await tx
        .update(schema.sponsoredQuestApplications)
        .set({
          status: "paid",
          payoutCoins,
          approvedAt: new Date(),
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.sponsoredQuestApplications.id, app.id));

      // Notify creator
      await insertNotification(
        tx,
        app.creatorId,
        "sponsored_quest_paid",
        "Sponsored quest payout received",
        `You've been paid ${payoutCoins} coins for "${quest.title}".`,
        { questId: app.questId, questTitle: quest.title, payoutCoins, applicationId: app.id }
      ).catch(() => {});
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          applicationId: app.id,
          status: "paid",
          payoutCoins,
          creatorId: app.creatorId,
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
