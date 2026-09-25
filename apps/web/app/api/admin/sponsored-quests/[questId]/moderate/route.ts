export const dynamic = 'force-dynamic';

/**
 * app/api/admin/sponsored-quests/[questId]/moderate/route.ts
 *
 * Admin/moderator approval queue action for a business-submitted Sponsored
 * Quest (PRD §17 — "requires approval; admin can set whether manual or the
 * built-in AI moderation system"). Separate from the generic PATCH on
 * app/api/admin/sponsored-quests/[questId]/route.ts (field edits) and from
 * app/api/creator/sponsored-quests/[questId]/approve/route.ts (which
 * approves a *creator's completed application*, not the quest listing
 * itself).
 *
 * POST /api/admin/sponsored-quests/:questId/moderate
 *   Body: { action: "approve" | "reject", reason?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { syncSponsoredQuestTemplate } from "@/lib/quests/sponsoredQuestPacing";
import { insertNotification } from "@/lib/notifications/insert";

interface Ctx {
  params: Promise<{ questId: string }>;
  auth: AdminContext;
}

const bodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().max(500).optional(),
});

export const POST = withAdminAuth(async (req: NextRequest, { params, auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { questId } = await params;
    const body = await validateBody(req, bodySchema);

    const orm = await getDb();

    const rows = await orm
      .select({
        id: schema.sponsoredQuests.id,
        business_account_id: schema.sponsoredQuests.businessAccountId,
        submitted_by: schema.sponsoredQuests.submittedBy,
        title: schema.sponsoredQuests.title,
        moderation_status: schema.sponsoredQuests.moderationStatus,
      })
      .from(schema.sponsoredQuests)
      .where(and(eq(schema.sponsoredQuests.id, questId), isNull(schema.sponsoredQuests.deletedAt)))
      .limit(1);
    const quest = rows[0];
    if (!quest) throw notFound("Sponsored quest not found");
    if (!quest.business_account_id) {
      throw badRequest("This quest was published directly by admin — there is nothing to moderate.");
    }
    if (quest.moderation_status !== "pending") {
      throw badRequest(`Quest is already ${quest.moderation_status}.`);
    }

    const approve = body.action === "approve";
    // NOTE: sponsored_quests has no updated_at column in the Drizzle schema —
    // see the same note in app/api/admin/sponsored-quests/[questId]/flag/route.ts.
    await orm
      .update(schema.sponsoredQuests)
      .set({
        moderationStatus: approve ? "approved" : "rejected",
        moderationReason: body.reason ?? null,
        isActive: approve,
      })
      .where(eq(schema.sponsoredQuests.id, questId));

    await syncSponsoredQuestTemplate(orm, questId);

    if (quest.submitted_by) {
      await insertNotification(
        orm,
        quest.submitted_by,
        "sponsored_quest_moderated",
        approve ? "Sponsored Quest approved" : "Sponsored Quest rejected",
        approve
          ? `Your Sponsored Quest "${quest.title}" is now live.`
          : `Your Sponsored Quest "${quest.title}" was rejected.${body.reason ? ` Reason: ${body.reason}` : ""}`,
        { questId, moderationStatus: approve ? "approved" : "rejected" }
      ).catch(() => {});
    }

    await orm
      .insert(schema.adminAuditLog)
      .values({
        adminId: auth.user.sub,
        action: `sponsored_quest_${body.action}`,
        resource: "sponsored_quest",
        resourceId: questId,
        afterVal: { reason: body.reason ?? null },
      })
      .catch(() => {});

    return NextResponse.json({ success: true, data: { questId, moderationStatus: approve ? "approved" : "rejected" }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
