export const dynamic = 'force-dynamic';

/**
 * app/api/quests/owned/[questId]/route.ts
 *
 * PATCH /api/quests/owned/:questId — the admin-assigned quest "creator"'s
 * only allowed writes: revive a completed/expired quest, extend a running
 * one's end date, or top up its budget. Public-facing details (title,
 * description, reward, etc.) are never editable here — the owner must ask
 * an admin, or (per product decision) submit a brand-new quest, which goes
 * through moderation again like any other submission.
 *
 * Body: { action: "revive" | "extend" | "add_budget", newEndsAt?: string, addBudgetCredits?: number }
 * A quest the system auto-paused (banned/lapsed account) cannot be revived
 * from here — see app/api/business/sponsored-quests/[questId]/restart for
 * that flow, which re-checks account eligibility.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody, type AuthContext } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { syncSponsoredQuestTemplate } from "@/lib/quests/sponsoredQuestPacing";

const bodySchema = z.object({
  action: z.enum(["revive", "extend", "add_budget"]),
  newEndsAt: z.string().datetime().optional(),
  addBudgetCredits: z.number().positive().optional(),
});

export const PATCH = withAuth(
  async (req: NextRequest, { params, auth }: { params: Promise<{ questId: string }>; auth: AuthContext }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
      const { questId } = await params;
      const body = await validateBody(req, bodySchema);

      const orm = await getDb();

      const rows = await orm
        .select({
          id: schema.sponsoredQuests.id,
          auto_paused: schema.sponsoredQuests.autoPaused,
          flag_status: schema.sponsoredQuests.flagStatus,
          moderation_status: schema.sponsoredQuests.moderationStatus,
        })
        .from(schema.sponsoredQuests)
        .where(
          and(
            eq(schema.sponsoredQuests.id, questId),
            eq(schema.sponsoredQuests.ownerUserId, auth.user.sub),
            isNull(schema.sponsoredQuests.deletedAt)
          )
        )
        .limit(1);
      const quest = rows[0];
      if (!quest) throw notFound("Sponsored quest not found");
      if (quest.flag_status === "flagged") throw conflict("This quest is flagged for review and cannot be changed until cleared by an admin.");
      if (quest.moderation_status !== "approved") throw conflict("This quest has not been approved yet.");

      if (body.action === "revive") {
        if (quest.auto_paused) {
          throw conflict("This quest was auto-paused due to an account issue — restart it from your Business panel once resolved, not here.");
        }
        // NOTE: original raw SQL also set `updated_at = NOW()`, but
        // lib/db/schema.ts's sponsoredQuests table has no updatedAt column
        // (schema mismatch — flagged, not silently patched).
        await orm
          .update(schema.sponsoredQuests)
          .set({ isActive: true, pauseReason: null, pausedAt: null })
          .where(eq(schema.sponsoredQuests.id, questId));
      } else if (body.action === "extend") {
        if (!body.newEndsAt) throw badRequest("newEndsAt is required for the extend action");
        await orm
          .update(schema.sponsoredQuests)
          .set({ endsAt: new Date(body.newEndsAt) })
          .where(eq(schema.sponsoredQuests.id, questId));
      } else {
        if (!body.addBudgetCredits) throw badRequest("addBudgetCredits is required for the add_budget action");
        await orm
          .update(schema.sponsoredQuests)
          .set({
            totalBudgetCredits: sql`${schema.sponsoredQuests.totalBudgetCredits} + ${body.addBudgetCredits}`,
          })
          .where(eq(schema.sponsoredQuests.id, questId));
      }

      await syncSponsoredQuestTemplate(orm, questId);

      return NextResponse.json({ success: true, data: { questId, action: body.action }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
