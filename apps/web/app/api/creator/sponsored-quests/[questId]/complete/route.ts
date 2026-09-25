export const dynamic = 'force-dynamic';

/**
 * app/api/creator/sponsored-quests/[questId]/complete/route.ts
 *
 * POST /api/creator/sponsored-quests/[questId]/complete
 *
 * Creator submits proof of completion for a sponsored quest they applied to.
 *
 * Flow (PRD §14 — Sponsored Quest 70/30 split):
 *  1. Creator must have an 'accepted' application for this quest.
 *  2. Creator submits completion proof (URL, description, etc.).
 *  3. Application status → 'completed'; timestamps recorded.
 *  4. Triggers admin notification for review.
 *
 * Payout is triggered by admin approval via /approve endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { insertNotificationBatch } from "@/lib/notifications/insert";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const completeQuestSchema = z.object({
  completionProof: z
    .string()
    .min(10, "Completion proof must be at least 10 characters")
    .max(2000),
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export const POST = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { questId: string }; auth: { user: { sub: string } } }
) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);
    const { questId } = await params as { questId: string };

    const body = await validateBody(req, completeQuestSchema);

    const orm = await getDb();

    // Fetch quest
    const questRows = await orm
      .select({
        id: schema.sponsoredQuests.id,
        title: schema.sponsoredQuests.title,
        deadline: schema.sponsoredQuests.deadline,
        isActive: schema.sponsoredQuests.isActive,
      })
      .from(schema.sponsoredQuests)
      .where(eq(schema.sponsoredQuests.id, questId))
      .limit(1);
    const quest = questRows[0];
    if (!quest) throw notFound("Sponsored quest not found");
    if (!quest.isActive || !quest.deadline || new Date(quest.deadline) < new Date()) {
      throw badRequest("This quest is no longer accepting completions");
    }

    // Verify creator has an accepted application
    const appRows = await orm
      .select({ id: schema.sponsoredQuestApplications.id, status: schema.sponsoredQuestApplications.status })
      .from(schema.sponsoredQuestApplications)
      .where(
        and(
          eq(schema.sponsoredQuestApplications.questId, questId),
          eq(schema.sponsoredQuestApplications.creatorId, userId)
        )
      )
      .limit(1);
    const app = appRows[0];
    if (!app) throw notFound("You have not applied to this quest");
    if (!["applied", "accepted"].includes(app.status)) {
      throw badRequest(`Quest completion not allowed in '${app.status}' status`);
    }

    // Update application to 'completed'
    await orm
      .update(schema.sponsoredQuestApplications)
      .set({
        status: "completed",
        completionProof: body.completionProof,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.sponsoredQuestApplications.id, app.id));

    // Notify admin for review (best-effort)
    (async () => {
      const admins = await orm
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.isAdmin, true), isNull(schema.users.deletedAt)))
        .limit(5);
      if (admins.length === 0) return;
      await insertNotificationBatch(
        orm,
        admins.map((a) => a.id),
        "sponsored_quest_completion_pending",
        "Sponsored quest completion pending review",
        `A creator submitted completion proof for "${quest.title}".`,
        { questId, questTitle: quest.title, creatorId: userId, applicationId: app.id }
      );
    })().catch(() => {});

    return NextResponse.json(
      {
        success: true,
        data: {
          applicationId: app.id,
          status: "completed",
          message: "Completion submitted. Awaiting admin review for payout.",
        },
        error: null,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
