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
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { logger } from "@/lib/logger";
import {
  canSubmitSponsoredQuests,
  getSponsoredQuestModerationMode,
  getSponsoredQuestAiAutoApproveThreshold,
} from "@/lib/business/limits";
import { classifySponsoredQuest } from "@/lib/moderation/aiClassifier";

const createSchema = z.object({
  businessPageId: z.string().uuid(),
  title: z.string().min(3).max(150),
  description: z.string().min(10).max(2000),
  requirements: z.string().min(10).max(2000),
  rewardCoins: z.number().int().positive(),
  maxApplications: z.number().int().positive().max(1000).default(10),
  deadline: z.string().datetime(),
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
}

async function getOwnBusinessAccount(userId: string): Promise<{ id: string; tier: string; business_name: string } | null> {
  const { rows } = await db.query<{ id: string; tier: string; business_name: string }>(
    `SELECT id, tier, business_name FROM business_accounts WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("businessAccounts");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const account = await getOwnBusinessAccount(auth.user.sub);
    if (!account) throw notFound("Business account not found");

    const { rows } = await db.query<SponsoredQuestBusinessRow>(
      `SELECT sq.id, sq.title, sq.description, sq.reward_coins, sq.max_applications, sq.deadline,
              sq.is_active, sq.moderation_status, sq.moderation_reason, sq.business_page_id, sq.created_at,
              COUNT(sqa.id)::int AS application_count
       FROM sponsored_quests sq
       LEFT JOIN sponsored_quest_applications sqa ON sqa.quest_id = sq.id
       WHERE sq.business_account_id = $1 AND sq.deleted_at IS NULL
       GROUP BY sq.id
       ORDER BY sq.created_at DESC`,
      [account.id]
    );

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

    const { rows: pageRows } = await db.query<{ id: string; name: string; avatar_url: string | null }>(
      `SELECT id, name, avatar_url FROM business_pages
       WHERE id = $1 AND business_account_id = $2 AND deleted_at IS NULL AND status = 'active' LIMIT 1`,
      [body.businessPageId, account.id]
    );
    const page = pageRows[0];
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

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO sponsored_quests
         (brand_name, brand_logo_url, title, description, requirements,
          reward_coins, creator_share_percent, platform_share_percent,
          max_applications, deadline, min_creator_tier, is_active,
          business_account_id, business_page_id, submitted_by,
          moderation_status, moderation_reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,70,30,$7,$8,'verified',$9,$10,$11,$12,$13,$14,NOW())
       RETURNING id`,
      [
        page.name,
        page.avatar_url,
        body.title,
        body.description,
        body.requirements,
        body.rewardCoins,
        body.maxApplications,
        body.deadline,
        moderationStatus === "approved",
        account.id,
        page.id,
        auth.user.sub,
        moderationStatus,
        moderationReason,
      ]
    );

    if (moderationStatus === "pending") {
      await db
        .query(
          `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
           VALUES ('sponsored_quest_pending_review', 'info', $1, $2::jsonb, NOW())`,
          [
            `Business "${account.business_name}" submitted a Sponsored Quest ("${body.title}") pending moderation.`,
            JSON.stringify({ questId: rows[0].id, businessAccountId: account.id }),
          ]
        )
        .catch((err) => logger.error({ err }, "[business/sponsored-quests] failed to write system_alert"));
    }

    return NextResponse.json(
      { success: true, data: { questId: rows[0].id, moderationStatus }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
