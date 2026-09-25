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
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

      const orm = await getDb();

      const rows = await orm
        .select({ id: schema.sponsoredQuests.id })
        .from(schema.sponsoredQuests)
        .where(and(eq(schema.sponsoredQuests.id, questId), isNull(schema.sponsoredQuests.deletedAt)))
        .limit(1);
      if (!rows[0]) throw notFound("Sponsored quest not found");

      // NOTE: sponsored_quests has no updated_at column in the Drizzle schema
      // (lib/db/schema.ts) even though the previous raw-SQL version of this
      // route set `updated_at = NOW()` — a pre-existing schema/route mismatch,
      // left unset here rather than silently added to the shared schema.
      if (body.action === "flag") {
        await orm
          .update(schema.sponsoredQuests)
          .set({
            flagStatus: "flagged",
            flagCategory: body.category ?? null,
            flagReason: body.reason ?? null,
            flaggedBy: auth.user.sub,
            flaggedAt: new Date(),
          })
          .where(eq(schema.sponsoredQuests.id, questId));
      } else {
        await orm
          .update(schema.sponsoredQuests)
          .set({
            flagStatus: "none",
            flagCategory: null,
            flagReason: null,
            flaggedBy: null,
            flaggedAt: null,
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
