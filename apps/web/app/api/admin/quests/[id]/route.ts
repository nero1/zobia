export const dynamic = 'force-dynamic';

/**
 * app/api/admin/quests/[id]/route.ts
 *
 * PATCH /api/admin/quests/:id — edit a core quest template's data-driven
 * fields (reward amounts, eligibility, category/copy) or toggle it
 * on/off. See app/api/admin/quests/route.ts for what is intentionally
 * NOT editable here (action_type, and the hardcoded deck-size/bonus
 * constants) and why.
 *
 * Sponsored-quest shadow rows (quest_templates.sponsored_quest_id NOT
 * NULL) are rejected — they're owned by /gate44/sponsored-quests, which
 * re-upserts them from the sponsored_quests row on every edit there.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { logger } from "@/lib/logger";
import { QUEST_FEATURE_KEYS, TRACK_COLUMN } from "@/lib/quests/questEngine";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const updateSchema = z.object({
  title: z.string().min(2).max(120).optional(),
  description: z.string().min(2).max(500).optional(),
  targetCount: z.number().int().positive().max(100000).optional(),
  xpReward: z.number().int().min(0).max(100000).optional(),
  coinReward: z.number().int().min(0).max(100000).optional(),
  category: z.string().min(1).max(60).optional(),
  icon: z.string().max(8).nullable().optional(),
  planRequired: z.enum(["free", "plus", "pro", "max"]).optional(),
  track: z.enum(Object.keys(TRACK_COLUMN) as [string, ...string[]]).optional(),
  featureKey: z.enum(QUEST_FEATURE_KEYS as unknown as [string, ...string[]]).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = withAdminAuth(
  async (req: NextRequest, { params, auth }: { params: Promise<{ id: string }>; auth: AdminContext }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
      const { id } = await params;
      if (!UUID_RE.test(id)) throw badRequest("id must be a valid UUID");

      const body = await validateBody(req, updateSchema);

      const orm = await getDb();

      const existingRows = await orm
        .select({
          id: schema.questTemplates.id,
          title: schema.questTemplates.title,
          description: schema.questTemplates.description,
          action_type: schema.questTemplates.actionType,
          target_count: schema.questTemplates.targetCount,
          xp_reward: schema.questTemplates.xpReward,
          coin_reward: schema.questTemplates.coinReward,
          category: schema.questTemplates.category,
          icon: schema.questTemplates.icon,
          plan_required: schema.questTemplates.planRequired,
          track: schema.questTemplates.track,
          feature_key: schema.questTemplates.featureKey,
          is_active: schema.questTemplates.isActive,
          sponsored_quest_id: schema.questTemplates.sponsoredQuestId,
        })
        .from(schema.questTemplates)
        .where(eq(schema.questTemplates.id, id))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) throw notFound("Quest template not found");
      if (existing.sponsored_quest_id) {
        throw badRequest(
          "This quest is a Sponsored Quest shadow row — edit it from /gate44/sponsored-quests instead."
        );
      }

      // Field names in `body` already match the Drizzle schema's camelCase
      // columns 1:1, so the update payload can be built directly from it.
      const setValues: Partial<typeof schema.questTemplates.$inferInsert> = {};
      for (const key of Object.keys(body) as (keyof typeof body)[]) {
        const val = body[key];
        if (val !== undefined) {
          (setValues as Record<string, unknown>)[key] = val;
        }
      }
      if (Object.keys(setValues).length === 0) throw badRequest("No fields to update");

      const rows = await orm
        .update(schema.questTemplates)
        .set(setValues)
        .where(eq(schema.questTemplates.id, id))
        .returning({
          id: schema.questTemplates.id,
          title: schema.questTemplates.title,
          description: schema.questTemplates.description,
          action_type: schema.questTemplates.actionType,
          target_count: schema.questTemplates.targetCount,
          xp_reward: schema.questTemplates.xpReward,
          coin_reward: schema.questTemplates.coinReward,
          category: schema.questTemplates.category,
          icon: schema.questTemplates.icon,
          plan_required: schema.questTemplates.planRequired,
          track: schema.questTemplates.track,
          feature_key: schema.questTemplates.featureKey,
          is_active: schema.questTemplates.isActive,
        });

      try {
        await orm.insert(schema.adminAuditLog).values({
          adminId: auth.user.sub,
          action: "update_quest_template",
          resource: "quest_templates",
          resourceId: id,
          beforeVal: existing,
          afterVal: rows[0],
        });
      } catch (auditErr) {
        logger.error({ err: auditErr, questId: id }, "[admin:quests] Failed to write admin_audit_log entry (non-fatal)");
      }

      return NextResponse.json({ success: true, data: { quest: rows[0] }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
