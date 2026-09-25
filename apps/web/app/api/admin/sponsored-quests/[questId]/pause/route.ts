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
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

      const orm = await getDb();

      const rows = await orm
        .select({ id: schema.sponsoredQuests.id, auto_paused: schema.sponsoredQuests.autoPaused })
        .from(schema.sponsoredQuests)
        .where(and(eq(schema.sponsoredQuests.id, questId), isNull(schema.sponsoredQuests.deletedAt)))
        .limit(1);
      if (!rows[0]) throw notFound("Sponsored quest not found");

      if (body.action === "resume" && rows[0].auto_paused) {
        throw conflict(
          "This quest was auto-paused because the owning account is banned or its subscription lapsed. Resolve the underlying account issue first — it cannot be resumed directly."
        );
      }

      // NOTE: sponsored_quests has no updated_at column in the Drizzle schema —
      // see the same note in app/api/admin/sponsored-quests/[questId]/flag/route.ts.
      if (body.action === "pause") {
        await orm
          .update(schema.sponsoredQuests)
          .set({
            isActive: false,
            pauseReason: body.reason ?? "Paused by admin",
            pausedBy: auth.user.sub,
            pausedAt: new Date(),
            autoPaused: false,
          })
          .where(eq(schema.sponsoredQuests.id, questId));
      } else {
        await orm
          .update(schema.sponsoredQuests)
          .set({
            isActive: true,
            pauseReason: null,
            pausedBy: null,
            pausedAt: null,
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
