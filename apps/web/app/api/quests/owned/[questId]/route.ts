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
import { db } from "@/lib/db";
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

      const { rows } = await db.query<{ id: string; auto_paused: boolean; flag_status: string; moderation_status: string }>(
        `SELECT id, auto_paused, flag_status, moderation_status FROM sponsored_quests
         WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [questId, auth.user.sub]
      );
      const quest = rows[0];
      if (!quest) throw notFound("Sponsored quest not found");
      if (quest.flag_status === "flagged") throw conflict("This quest is flagged for review and cannot be changed until cleared by an admin.");
      if (quest.moderation_status !== "approved") throw conflict("This quest has not been approved yet.");

      if (body.action === "revive") {
        if (quest.auto_paused) {
          throw conflict("This quest was auto-paused due to an account issue — restart it from your Business panel once resolved, not here.");
        }
        await db.query(`UPDATE sponsored_quests SET is_active = TRUE, pause_reason = NULL, paused_at = NULL, updated_at = NOW() WHERE id = $1`, [questId]);
      } else if (body.action === "extend") {
        if (!body.newEndsAt) throw badRequest("newEndsAt is required for the extend action");
        await db.query(`UPDATE sponsored_quests SET ends_at = $1, updated_at = NOW() WHERE id = $2`, [body.newEndsAt, questId]);
      } else {
        if (!body.addBudgetCredits) throw badRequest("addBudgetCredits is required for the add_budget action");
        await db.query(
          `UPDATE sponsored_quests SET total_budget_credits = total_budget_credits + $1, updated_at = NOW() WHERE id = $2`,
          [body.addBudgetCredits, questId]
        );
      }

      await syncSponsoredQuestTemplate(db, questId);

      return NextResponse.json({ success: true, data: { questId, action: body.action }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
