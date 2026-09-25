export const dynamic = 'force-dynamic';

/**
 * app/api/business/sponsored-quests/route.ts
 *
 * Business self-service Sponsored Quests (PRD §17 — "biz accounts should be
 * able to create sponsored quests (requires approval)"). This is the
 * business-facing counterpart to the admin-only
 * app/api/admin/sponsored-quests/route.ts — a Growth+ business account can
 * submit a quest attributed to one of its Business Pages; it starts
 * `is_active = false` until an admin (or the AI moderator, per the
 * `sponsored_quest_moderation_mode` toggle) approves it.
 *
 * GET  /api/business/sponsored-quests — list the caller's own submissions.
 * POST /api/business/sponsored-quests — submit a new quest for moderation.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled, getManifestValue } from "@/lib/manifest";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { logger } from "@/lib/logger";
import {
  canSubmitSponsoredQuests,
  getSponsoredQuestModerationMode,
  getSponsoredQuestAiAutoApproveThreshold,
} from "@/lib/business/limits";
import { classifySponsoredQuest } from "@/lib/moderation/aiClassifier";
import { estimateSponsoredQuestReach, syncSponsoredQuestTemplate } from "@/lib/quests/sponsoredQuestPacing";
import { raiseAlert } from "@/lib/alerts/dispatch";

const createSchema = z.object({
  businessPageId: z.string().uuid(),
  title: z.string().min(3).max(150),
  description: z.string().min(10).max(2000),
  requirements: z.string().min(10).max(2000),
  rewardCoins: z.number().int().positive(),
  maxApplications: z.number().int().positive().max(1000).default(10),
  deadline: z.string().datetime(),
  // Daily-deck distribution (in addition to the creator-application
  // marketplace above) — Facebook-Ads-style duration + budget, paced as
  // impression CPM under the hood (lib/quests/sponsoredQuestPacing.ts).
  isDailyQuestEligible: z.boolean().default(false),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  totalBudgetCredits: z.number().min(0).default(0),
  dailyBudgetCredits: z.number().min(0).optional().nullable(),
  targetAction: z.string().min(1).max(100).optional(),
  targetValue: z.number().int().positive().optional(),
});

interface SponsoredQuestBusinessRow {
  id: string;
  title: string;
  description: string;
  reward_coins: number;
  max_applications: number;
  deadline: string;
  is_active: boolean;
  moderation_status: string;
  moderation_reason: string | null;
  business_page_id: string | null;
  created_at: string;
  application_count: number;
  is_daily_quest_eligible: boolean;
  starts_at: string | null;
  ends_at: string | null;
  total_budget_credits: string;
  spent_credits: string;
  daily_budget_credits: string | null;
  cpm_credits: string;
  estimated_reach: number | null;
  impressions_count: number;
  auto_paused: boolean;
  pause_reason: string | null;
}

async function getOwnBusinessAccount(userId: string): Promise<{ id: string; tier: string; business_name: string } | null> {
  const orm = await getDb();
  const [row] = await orm
    .select({
      id: schema.businessAccounts.id,
      tier: schema.businessAccounts.tier,
      business_name: schema.businessAccounts.businessName,
    })
    .from(schema.businessAccounts)
    .where(eq(schema.businessAccounts.userId, userId))
    .limit(1);
  return row ?? null;
}

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("businessAccounts");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const account = await getOwnBusinessAccount(auth.user.sub);
    if (!account) throw notFound("Business account not found");

    const orm = await getDb();
    const sq = schema.sponsoredQuests;
    const sqa = schema.sponsoredQuestApplications;
    const rows = await orm
      .select({
        id: sq.id,
        title: sq.title,
        description: sq.description,
        reward_coins: sq.rewardCoins,
        max_applications: sq.maxApplications,
        deadline: sq.deadline,
        is_active: sq.isActive,
        moderation_status: sq.moderationStatus,
        moderation_reason: sq.moderationReason,
        business_page_id: sq.businessPageId,
        created_at: sq.createdAt,
        is_daily_quest_eligible: sq.isDailyQuestEligible,
        starts_at: sq.startsAt,
        ends_at: sq.endsAt,
        total_budget_credits: sq.totalBudgetCredits,
        spent_credits: sq.spentCredits,
        daily_budget_credits: sq.dailyBudgetCredits,
        cpm_credits: sq.cpmCredits,
        estimated_reach: sq.estimatedReach,
        impressions_count: sq.impressionsCount,
        auto_paused: sq.autoPaused,
        pause_reason: sq.pauseReason,
        application_count: sql<number>`COUNT(${sqa.id})::int`,
      })
      .from(sq)
      .leftJoin(sqa, eq(sqa.questId, sq.id))
      .where(and(eq(sq.businessAccountId, account.id), isNull(sq.deletedAt)))
      .groupBy(sq.id)
      .orderBy(desc(sq.createdAt));

    return NextResponse.json({ success: true, data: { quests: rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("businessAccounts");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const account = await getOwnBusinessAccount(auth.user.sub);
    if (!account) throw notFound("Business account not found");
    if (!canSubmitSponsoredQuests(account.tier)) {
      throw forbidden(
        "Sponsored Quests require the Business Growth tier or higher. Upgrade your business tier to access the Quest Marketplace.",
        "BUSINESS_TIER_TOO_LOW"
      );
    }

    const body = await validateBody(req, createSchema);

    if (new Date(body.deadline) <= new Date()) {
      throw badRequest("deadline must be in the future");
    }
    if (body.isDailyQuestEligible) {
      if (!body.startsAt || !body.endsAt) {
        throw badRequest("startsAt and endsAt are required when isDailyQuestEligible is true");
      }
      if (new Date(body.endsAt) <= new Date(body.startsAt)) {
        throw badRequest("endsAt must be after startsAt");
      }
      if (body.totalBudgetCredits <= 0) {
        throw badRequest("totalBudgetCredits must be greater than 0 to run in the daily quest deck");
      }
    }

    const orm = await getDb();
    const [page] = await orm
      .select({
        id: schema.businessPages.id,
        name: schema.businessPages.name,
        avatar_url: schema.businessPages.avatarUrl,
      })
      .from(schema.businessPages)
      .where(
        and(
          eq(schema.businessPages.id, body.businessPageId),
          eq(schema.businessPages.businessAccountId, account.id),
          isNull(schema.businessPages.deletedAt),
          eq(schema.businessPages.status, "active")
        )
      )
      .limit(1);
    if (!page) throw badRequest("businessPageId must reference one of your active Business Pages");

    const mode = await getSponsoredQuestModerationMode();
    let moderationStatus: "pending" | "approved" = "pending";
    let moderationReason: string | null = null;

    if (mode === "ai") {
      const review = await classifySponsoredQuest(page.name, body.title, body.description, body.requirements);
      const threshold = await getSponsoredQuestAiAutoApproveThreshold();
      if (review.approvalConfidence >= threshold) {
        moderationStatus = "approved";
      }
      moderationReason = review.reason;
    }

    const durationDays = body.startsAt && body.endsAt
      ? Math.max(1, Math.round((new Date(body.endsAt).getTime() - new Date(body.startsAt).getTime()) / 86_400_000))
      : 7;
    const cpmCredits = await getManifestValue("sponsored_quest_default_cpm_credits").then((v) => (v ? Number(v) : 500));
    const estimatedReach = body.isDailyQuestEligible
      ? estimateSponsoredQuestReach(body.totalBudgetCredits, cpmCredits, durationDays).totalImpressions
      : null;

    const [inserted] = await orm
      .insert(schema.sponsoredQuests)
      .values({
        brandName: page.name,
        brandLogoUrl: page.avatar_url,
        title: body.title,
        description: body.description,
        requirements: body.requirements,
        rewardCoins: body.rewardCoins,
        creatorSharePercent: 70,
        platformSharePercent: 30,
        maxApplications: body.maxApplications,
        deadline: new Date(body.deadline),
        minCreatorTier: "verified",
        isActive: moderationStatus === "approved",
        businessAccountId: account.id,
        businessPageId: page.id,
        submittedBy: auth.user.sub,
        moderationStatus,
        moderationReason,
        isDailyQuestEligible: body.isDailyQuestEligible,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        pricingModel: "hybrid",
        totalBudgetCredits: String(body.totalBudgetCredits),
        dailyBudgetCredits: body.dailyBudgetCredits != null ? String(body.dailyBudgetCredits) : null,
        cpmCredits: String(cpmCredits),
        estimatedReach,
        fundedByUserId: auth.user.sub,
        targetAction: body.targetAction ?? null,
        targetValue: body.targetValue ?? null,
      })
      .returning({ id: schema.sponsoredQuests.id });

    if (body.isDailyQuestEligible && moderationStatus === "approved") {
      await syncSponsoredQuestTemplate(orm, inserted.id);
    }

    if (moderationStatus === "pending") {
      await raiseAlert(orm, {
        type: "sponsored_quest_pending_review",
        category: "moderation",
        priorityLevel: 6,
        title: "Sponsored Quest pending review",
        message: `Business "${account.business_name}" submitted a Sponsored Quest ("${body.title}") pending moderation.`,
        metadata: { questId: inserted.id, businessAccountId: account.id },
      }).catch((err) => logger.error({ err }, "[business/sponsored-quests] failed to write system_alert"));
    }

    return NextResponse.json(
      { success: true, data: { questId: inserted.id, moderationStatus }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
