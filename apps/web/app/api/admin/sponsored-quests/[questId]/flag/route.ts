export const dynamic = 'force-dynamic';

/**
 * app/api/admin/sponsored-quests/[questId]/flag/route.ts
 *
 * POST /api/admin/sponsored-quests/:questId/flag
 *   Flag (or clear a flag on) a Sponsored Quest for follow-up — spam, scam,
 *   or another concern that doesn't warrant an outright reject/delete but
 *   should stop it from running and surface it for review.
 *   Body: { action: "flag" | "unflag", category?: "spam"|"scam"|"other", reason?: string }
 *   A flagged quest is excluded from the daily-deck pool immediately
 *   (syncSponsoredQuestTemplate) but is not deleted — admin can unflag once
 *   reviewed.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { syncSponsoredQuestTemplate } from "@/lib/quests/sponsoredQuestPacing";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  action: z.enum(["flag", "unflag"]),
  category: z.enum(["spam", "scam", "other"]).optional(),
  reason: z.string().max(500).optional(),
});

export const POST = withAdminAuth(
  async (req: NextRequest, { params, auth }: { params: Promise<{ questId: string }>; auth: AdminContext }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
      const { questId } = await params;
      if (!UUID_RE.test(questId)) throw badRequest("questId must be a valid UUID");

      const body = await validateBody(req, bodySchema);
      if (body.action === "flag" && !body.category) {
        throw badRequest("category is required when flagging a quest");
      }

      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM sponsored_quests WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [questId]
      );
      if (!rows[0]) throw notFound("Sponsored quest not found");

      if (body.action === "flag") {
        await db.query(
          `UPDATE sponsored_quests
           SET flag_status = 'flagged', flag_category = $1, flag_reason = $2,
               flagged_by = $3, flagged_at = NOW(), updated_at = NOW()
           WHERE id = $4`,
          [body.category ?? null, body.reason ?? null, auth.user.sub, questId]
        );
      } else {
        await db.query(
          `UPDATE sponsored_quests
           SET flag_status = 'none', flag_category = NULL, flag_reason = NULL,
               flagged_by = NULL, flagged_at = NULL, updated_at = NOW()
           WHERE id = $1`,
          [questId]
        );
      }

      await syncSponsoredQuestTemplate(db, questId);

      return NextResponse.json({ success: true, data: { questId, action: body.action }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
