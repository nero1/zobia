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
import { db } from "@/lib/db";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

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

    const { rows } = await db.query<{ id: string; business_account_id: string | null; submitted_by: string | null; title: string; moderation_status: string }>(
      `SELECT id, business_account_id, submitted_by, title, moderation_status
       FROM sponsored_quests WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [questId]
    );
    const quest = rows[0];
    if (!quest) throw notFound("Sponsored quest not found");
    if (!quest.business_account_id) {
      throw badRequest("This quest was published directly by admin — there is nothing to moderate.");
    }
    if (quest.moderation_status !== "pending") {
      throw badRequest(`Quest is already ${quest.moderation_status}.`);
    }

    const approve = body.action === "approve";
    await db.query(
      `UPDATE sponsored_quests
       SET moderation_status = $1, moderation_reason = $2, is_active = $3, updated_at = NOW()
       WHERE id = $4`,
      [approve ? "approved" : "rejected", body.reason ?? null, approve, questId]
    );

    if (quest.submitted_by) {
      await db
        .query(
          `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
           VALUES ($1, 'sponsored_quest_moderated', $2, $3, $4::jsonb, false, NOW())`,
          [
            quest.submitted_by,
            approve ? "Sponsored Quest approved" : "Sponsored Quest rejected",
            approve
              ? `Your Sponsored Quest "${quest.title}" is now live.`
              : `Your Sponsored Quest "${quest.title}" was rejected.${body.reason ? ` Reason: ${body.reason}` : ""}`,
            JSON.stringify({ questId, moderationStatus: approve ? "approved" : "rejected" }),
          ]
        )
        .catch(() => {});
    }

    await db
      .query(
        `INSERT INTO admin_audit_log (admin_id, action, resource, resource_id, after_val, created_at)
         VALUES ($1, $2, 'sponsored_quest', $3, $4::jsonb, NOW())`,
        [auth.user.sub, `sponsored_quest_${body.action}`, questId, JSON.stringify({ reason: body.reason ?? null })]
      )
      .catch(() => {});

    return NextResponse.json({ success: true, data: { questId, moderationStatus: approve ? "approved" : "rejected" }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
