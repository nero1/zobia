export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { creditCoins } from "@/lib/economy/coins";
import { insertNotification } from "@/lib/notifications/insert";
import { loadManifest } from "@/lib/manifest";
const bodySchema = z.object({
  applicationId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  rejectionReason: z.string().max(500).optional(),
});
export const POST = withAdminAuth(
  async (req: NextRequest, { params, auth }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
      const body = await validateBody(req, bodySchema),
        db = await getDb();
      const [snapshot] = await db
        .select()
        .from(schema.sponsoredQuestApplications)
        .where(eq(schema.sponsoredQuestApplications.id, body.applicationId));
      if (!snapshot || snapshot.questId !== params.questId)
        throw notFound("Application not found in this campaign");
      const manifest = await loadManifest();
      const result = await db.transaction(async (tx) => {
        const [creator] = await tx
          .select({
            id: schema.users.id,
            deletedAt: schema.users.deletedAt,
            isBanned: schema.users.isBanned,
            isSuspended: schema.users.isSuspended,
            suspendedUntil: schema.users.suspendedUntil,
          })
          .from(schema.users)
          .where(eq(schema.users.id, snapshot.creatorId))
          .for("no key update");
        const [quest] = await tx
          .select()
          .from(schema.sponsoredQuests)
          .where(eq(schema.sponsoredQuests.id, snapshot.questId))
          .for("update");
        const [app] = await tx
          .select()
          .from(schema.sponsoredQuestApplications)
          .where(eq(schema.sponsoredQuestApplications.id, snapshot.id))
          .for("update");
        if (!quest || !app) throw notFound("Application not found");
        if (app.status !== "completed")
          throw badRequest(
            `Cannot ${body.action} application in '${app.status}' status`,
          );
        if (body.action === "reject") {
          await tx
            .update(schema.sponsoredQuestApplications)
            .set({ status: "rejected", updatedAt: new Date() })
            .where(eq(schema.sponsoredQuestApplications.id, app.id));
          await insertNotification(
            tx,
            app.creatorId,
            "sponsored_quest_rejected",
            "Sponsored quest application rejected",
            `Your application was not approved.${body.rejectionReason ? " Reason: " + body.rejectionReason : ""}`,
            { questId: quest.id, applicationId: app.id },
          );
          return { applicationId: app.id, status: "rejected", payoutCoins: 0 };
        }
        if (
          !creator ||
          creator.deletedAt ||
          creator.isBanned ||
          (creator.isSuspended &&
            (!creator.suspendedUntil || creator.suspendedUntil > new Date()))
        )
          throw badRequest("Creator account is unavailable for settlement");
        const [funding] = await tx
          .select()
          .from(schema.sponsoredQuestFunding)
          .where(eq(schema.sponsoredQuestFunding.questId, quest.id))
          .for("update");
        const reward = BigInt(quest.rewardCoins ?? 0);
        if (
          !funding ||
          funding.applicationsClosed ||
          reward <= 0n ||
          funding.applicationBalanceCoins < reward
        )
          throw badRequest(
            "This application has no funded settlement reserve",
            "SPONSORED_REWARD_UNFUNDED",
          );
        const payout = (reward * BigInt(quest.creatorSharePercent)) / 100n;
        await tx
          .update(schema.sponsoredQuestFunding)
          .set({
            applicationBalanceCoins: funding.applicationBalanceCoins - reward,
          })
          .where(eq(schema.sponsoredQuestFunding.questId, quest.id));
        if (payout)
          await creditCoins(
            app.creatorId,
            Number(payout),
            "sponsored_quest_payout",
            `sponsored-application:${app.id}`,
            "Sponsored quest payout",
            { questId: quest.id, applicationId: app.id },
            tx,
          );
        const gross = BigInt(
          new Decimal(reward.toString())
            .mul(manifest.coinToCashRate)
            .floor()
            .toFixed(0),
        );
        const net = BigInt(
          new Decimal(payout.toString())
            .mul(manifest.coinToCashRate)
            .floor()
            .toFixed(0),
        );
        // Informational coin-earning record; no duplicate cash balance is minted.
        await tx
          .insert(schema.creatorEarnings)
          .values({
            creatorId: app.creatorId,
            sourceType: "sponsored_quest",
            grossAmountKobo: gross,
            platformFeeKobo: gross - net,
            netAmountKobo: net,
            referenceId: app.id,
          });
        await tx
          .update(schema.sponsoredQuestApplications)
          .set({
            status: "paid",
            payoutCoins: Number(payout),
            approvedAt: new Date(),
            paidAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.sponsoredQuestApplications.id, app.id));
        await insertNotification(
          tx,
          app.creatorId,
          "sponsored_quest_paid",
          "Sponsored quest payout received",
          `${payout} Credits were paid for "${quest.title}".`,
          {
            questId: quest.id,
            applicationId: app.id,
            payoutCoins: Number(payout),
          },
        );
        return {
          applicationId: app.id,
          status: "paid",
          payoutCoins: Number(payout),
        };
      });
      return NextResponse.json({ success: true, data: result, error: null });
    } catch (error) {
      return handleApiError(error);
    }
  },
);
