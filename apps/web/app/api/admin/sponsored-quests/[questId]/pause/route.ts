export const dynamic = 'force-dynamic';

/**
 * app/api/admin/sponsored-quests/[questId]/pause/route.ts
 *
 * POST /api/admin/sponsored-quests/:questId/pause
 *   Admin pause/resume for follow-up (distinct from moderation reject and
 *   from flag-for-review). Body: { action: "pause" | "resume", reason?: string }
 *   Resuming a quest the system auto-paused (auto_paused=true, e.g. the
 *   owning business account was banned or its subscription lapsed) is
 *   blocked — the underlying issue must be resolved first (account
 *   restored / subscription renewed), never overridden here.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { syncSponsoredQuestTemplate } from "@/lib/quests/sponsoredQuestPacing";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  action: z.enum(["pause", "resume"]),
  reason: z.string().max(500).optional(),
});

export const POST = withAdminAuth(
  async (req: NextRequest, { params, auth }: { params: Promise<{ questId: string }>; auth: AdminContext }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
      const { questId } = await params;
      if (!UUID_RE.test(questId)) throw badRequest("questId must be a valid UUID");

      const body = await validateBody(req, bodySchema);

      const { rows } = await db.query<{ id: string; auto_paused: boolean }>(
        `SELECT id, auto_paused FROM sponsored_quests WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [questId]
      );
      if (!rows[0]) throw notFound("Sponsored quest not found");

      if (body.action === "resume" && rows[0].auto_paused) {
        throw conflict(
          "This quest was auto-paused because the owning account is banned or its subscription lapsed. Resolve the underlying account issue first — it cannot be resumed directly."
        );
      }

      if (body.action === "pause") {
        await db.query(
          `UPDATE sponsored_quests
           SET is_active = FALSE, pause_reason = $1, paused_by = $2, paused_at = NOW(), auto_paused = FALSE, updated_at = NOW()
           WHERE id = $3`,
          [body.reason ?? "Paused by admin", auth.user.sub, questId]
        );
      } else {
        await db.query(
          `UPDATE sponsored_quests
           SET is_active = TRUE, pause_reason = NULL, paused_by = NULL, paused_at = NULL, updated_at = NOW()
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
