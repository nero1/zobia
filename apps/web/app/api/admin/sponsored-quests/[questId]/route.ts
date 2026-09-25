export const dynamic = 'force-dynamic';

/**
 * app/api/admin/sponsored-quests/[questId]/route.ts
 *
 * Per-quest admin operations.
 *
 * PATCH /api/admin/sponsored-quests/:questId
 *   Update quest fields or toggle active status (edit / pause / activate).
 *
 * DELETE /api/admin/sponsored-quests/:questId
 *   Soft-delete a quest (sets deleted_at + is_active = FALSE).
 *
 * Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { syncSponsoredQuestTemplate } from "@/lib/quests/sponsoredQuestPacing";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z.object({
  brandName:            z.string().min(1).max(120).optional(),
  brandLogoUrl:         z.string().url().nullable().optional(),
  title:                z.string().min(3).max(150).optional(),
  description:          z.string().min(10).max(2000).optional(),
  requirements:         z.string().min(10).max(2000).optional(),
  rewardCoins:          z.number().int().positive().optional(),
  creatorSharePercent:  z.number().int().min(50).max(90).optional(),
  platformSharePercent: z.number().int().min(10).max(50).optional(),
  maxApplications:      z.number().int().positive().optional(),
  deadline:             z.string().datetime().optional(),
  minCreatorTier:       z.enum(["verified", "elite", "icon"]).optional(),
  isActive:             z.boolean().optional(),
  ownerUsername:        z.string().min(1).max(50).nullable().optional(),
  isDailyQuestEligible: z.boolean().optional(),
  startsAt:             z.string().datetime().nullable().optional(),
  endsAt:               z.string().datetime().nullable().optional(),
  totalBudgetCredits:   z.number().min(0).optional(),
  dailyBudgetCredits:   z.number().min(0).nullable().optional(),
  cpmCredits:           z.number().positive().optional(),
  targetAction:         z.string().min(1).max(100).nullable().optional(),
  targetValue:          z.number().int().positive().nullable().optional(),
});

interface QuestCtx {
  params: Promise<{ questId: string }>;
  auth: AdminContext;
}

export const PATCH = withAdminAuth(async (req: NextRequest, { params, auth }: QuestCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { questId } = await params;
    if (!UUID_RE.test(questId)) throw badRequest("questId must be a valid UUID");

    const body = await validateBody(req, patchSchema);

    // Validate share percents sum to 100 if both provided
    if (body.creatorSharePercent !== undefined && body.platformSharePercent !== undefined) {
      if (body.creatorSharePercent + body.platformSharePercent !== 100) {
        throw badRequest("creatorSharePercent + platformSharePercent must equal 100");
      }
    }

    // Deadline must be future if provided
    if (body.deadline && new Date(body.deadline) <= new Date()) {
      throw badRequest("deadline must be in the future");
    }

    const orm = await getDb();

    // Verify quest exists
    const questRows = await orm
      .select({
        id: schema.sponsoredQuests.id,
        creator_share_percent: schema.sponsoredQuests.creatorSharePercent,
        platform_share_percent: schema.sponsoredQuests.platformSharePercent,
      })
      .from(schema.sponsoredQuests)
      .where(and(eq(schema.sponsoredQuests.id, questId), isNull(schema.sponsoredQuests.deletedAt)))
      .limit(1);
    if (!questRows[0]) throw notFound("Sponsored quest not found");

    // Build the update payload dynamically — field names already match the
    // Drizzle schema's camelCase columns 1:1.
    // NOTE: sponsored_quests has no updated_at column in the Drizzle schema —
    // see the same note in the sibling flag/pause/moderate routes.
    const setValues: Record<string, unknown> = {};

    if (body.ownerUsername !== undefined) {
      if (body.ownerUsername === null) {
        setValues.ownerUserId = null;
      } else {
        const ownerRows = await orm
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(and(eq(schema.users.username, body.ownerUsername), isNull(schema.users.deletedAt)))
          .limit(1);
        if (!ownerRows[0]) throw badRequest(`No user found with username '${body.ownerUsername}'`);
        setValues.ownerUserId = ownerRows[0].id;
      }
    }

    const numericStringFields = new Set(["totalBudgetCredits", "dailyBudgetCredits", "cpmCredits"]);
    const dateFields = new Set(["deadline", "startsAt", "endsAt"]);
    const fieldKeys = [
      "brandName", "brandLogoUrl", "title", "description", "requirements", "rewardCoins",
      "creatorSharePercent", "platformSharePercent", "maxApplications", "deadline",
      "minCreatorTier", "isActive", "isDailyQuestEligible", "startsAt", "endsAt",
      "totalBudgetCredits", "dailyBudgetCredits", "cpmCredits", "targetAction", "targetValue",
    ] as const;

    for (const jsKey of fieldKeys) {
      const val = (body as Record<string, unknown>)[jsKey];
      if (val === undefined) continue;
      if (val === null) {
        setValues[jsKey] = null;
      } else if (dateFields.has(jsKey)) {
        setValues[jsKey] = new Date(val as string);
      } else if (numericStringFields.has(jsKey)) {
        setValues[jsKey] = String(val);
      } else {
        setValues[jsKey] = val;
      }
    }

    if (Object.keys(setValues).length === 0) {
      throw badRequest("No fields to update");
    }

    await orm
      .update(schema.sponsoredQuests)
      .set(setValues as typeof schema.sponsoredQuests.$inferInsert)
      .where(eq(schema.sponsoredQuests.id, questId));

    await syncSponsoredQuestTemplate(orm, questId);

    return NextResponse.json({ success: true, data: { questId } });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAdminAuth(async (req: NextRequest, { params, auth }: QuestCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { questId } = await params;
    if (!UUID_RE.test(questId)) throw badRequest("questId must be a valid UUID");

    const orm = await getDb();

    const rows = await orm
      .select({ id: schema.sponsoredQuests.id })
      .from(schema.sponsoredQuests)
      .where(and(eq(schema.sponsoredQuests.id, questId), isNull(schema.sponsoredQuests.deletedAt)))
      .limit(1);
    if (!rows[0]) throw notFound("Sponsored quest not found");

    await orm
      .update(schema.sponsoredQuests)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(schema.sponsoredQuests.id, questId));
    await syncSponsoredQuestTemplate(orm, questId);

    return NextResponse.json({ success: true, data: { questId, deleted: true } });
  } catch (err) {
    return handleApiError(err);
  }
});
