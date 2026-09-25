export const dynamic = 'force-dynamic';

/**
 * app/api/business/sponsored-quests/[questId]/route.ts
 *
 * PATCH  — edit a pending/rejected submission (re-submits for moderation).
 *          Approved/live quests cannot be edited here — cancel and
 *          resubmit instead, since applications may already be in flight.
 * DELETE — cancel a submission (soft-delete, applications untouched).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody, type AuthContext } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getSponsoredQuestModerationMode } from "@/lib/business/limits";
import { syncSponsoredQuestTemplate } from "@/lib/quests/sponsoredQuestPacing";

interface Ctx {
  params: Promise<{ questId: string }>;
  auth: AuthContext;
}

const updateSchema = z.object({
  title: z.string().min(3).max(150).optional(),
  description: z.string().min(10).max(2000).optional(),
  requirements: z.string().min(10).max(2000).optional(),
  rewardCoins: z.number().int().positive().optional(),
  maxApplications: z.number().int().positive().max(1000).optional(),
  deadline: z.string().datetime().optional(),
});

async function assertOwnedPendingOrRejected(questId: string, userId: string) {
  const orm = await getDb();
  const rows = await orm
    .select({
      id: schema.sponsoredQuests.id,
      businessAccountId: schema.sponsoredQuests.businessAccountId,
      ownerUserId: schema.businessAccounts.userId,
      moderationStatus: schema.sponsoredQuests.moderationStatus,
    })
    .from(schema.sponsoredQuests)
    .innerJoin(schema.businessAccounts, eq(schema.businessAccounts.id, schema.sponsoredQuests.businessAccountId))
    .where(and(eq(schema.sponsoredQuests.id, questId), isNull(schema.sponsoredQuests.deletedAt)))
    .limit(1);
  const quest = rows[0];
  if (!quest || quest.ownerUserId !== userId) throw notFound("Sponsored quest not found");
  return quest;
}

export const PATCH = withAuth(async (req: NextRequest, { params, auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { questId } = await params;
    const quest = await assertOwnedPendingOrRejected(questId, auth.user.sub);
    if (quest.moderationStatus === "approved") {
      throw forbidden("Live Sponsored Quests cannot be edited — cancel and resubmit instead.", "SPONSORED_QUEST_LIVE");
    }

    const body = await validateBody(req, updateSchema);
    if (body.deadline && new Date(body.deadline) <= new Date()) {
      throw badRequest("deadline must be in the future");
    }

    // NOTE (schema mismatch): sponsored_quests has no `updated_at` column in
    // the real DB or in lib/db/schema.ts — the original raw SQL's
    // `updated_at = NOW()` here would have thrown at runtime. Omitted.
    const updates: Partial<typeof schema.sponsoredQuests.$inferInsert> = {
      moderationStatus: "pending",
      moderationReason: null,
      isActive: false,
    };
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.requirements !== undefined) updates.requirements = body.requirements;
    if (body.rewardCoins !== undefined) updates.rewardCoins = body.rewardCoins;
    if (body.maxApplications !== undefined) updates.maxApplications = body.maxApplications;
    if (body.deadline !== undefined) updates.deadline = new Date(body.deadline);

    const orm = await getDb();
    await orm.update(schema.sponsoredQuests).set(updates).where(eq(schema.sponsoredQuests.id, questId));
    await syncSponsoredQuestTemplate(orm, questId);

    return NextResponse.json({
      success: true,
      data: { questId, moderationStatus: "pending", mode: await getSponsoredQuestModerationMode() },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth(async (_req: NextRequest, { params, auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { questId } = await params;
    await assertOwnedPendingOrRejected(questId, auth.user.sub);

    const orm = await getDb();
    await orm
      .update(schema.sponsoredQuests)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(schema.sponsoredQuests.id, questId));
    await syncSponsoredQuestTemplate(orm, questId);

    return NextResponse.json({ success: true, data: { questId, deleted: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
