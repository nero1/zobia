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
import { db } from "@/lib/db";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { logger } from "@/lib/logger";
import { QUEST_FEATURE_KEYS, TRACK_COLUMN } from "@/lib/quests/questEngine";
import type { SqlParam } from "@/lib/db/interface";

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

const FIELD_MAP: Record<keyof z.infer<typeof updateSchema>, string> = {
  title: "title",
  description: "description",
  targetCount: "target_count",
  xpReward: "xp_reward",
  coinReward: "coin_reward",
  category: "category",
  icon: "icon",
  planRequired: "plan_required",
  track: "track",
  featureKey: "feature_key",
  isActive: "is_active",
};

interface QuestTemplateRow {
  id: string;
  title: string;
  description: string;
  action_type: string;
  target_count: number;
  xp_reward: number;
  coin_reward: number;
  category: string;
  icon: string | null;
  plan_required: string | null;
  track: string | null;
  feature_key: string | null;
  is_active: boolean;
  sponsored_quest_id: string | null;
}

export const PATCH = withAdminAuth(
  async (req: NextRequest, { params, auth }: { params: Promise<{ id: string }>; auth: AdminContext }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
      const { id } = await params;
      if (!UUID_RE.test(id)) throw badRequest("id must be a valid UUID");

      const body = await validateBody(req, updateSchema);

      const { rows: existingRows } = await db.query<QuestTemplateRow>(
        `SELECT id, title, description, action_type, target_count, xp_reward, coin_reward,
                category, icon, plan_required, track, feature_key, is_active, sponsored_quest_id
         FROM quest_templates WHERE id = $1 LIMIT 1`,
        [id]
      );
      const existing = existingRows[0];
      if (!existing) throw notFound("Quest template not found");
      if (existing.sponsored_quest_id) {
        throw badRequest(
          "This quest is a Sponsored Quest shadow row — edit it from /gate44/sponsored-quests instead."
        );
      }

      const sets: string[] = [];
      const values: SqlParam[] = [];
      for (const [key, column] of Object.entries(FIELD_MAP) as [keyof typeof FIELD_MAP, string][]) {
        if (key in body && (body as Record<string, unknown>)[key] !== undefined) {
          values.push((body as Record<string, unknown>)[key] as SqlParam);
          sets.push(`${column} = $${values.length}`);
        }
      }
      if (sets.length === 0) throw badRequest("No fields to update");
      values.push(id);

      const { rows } = await db.query<QuestTemplateRow>(
        `UPDATE quest_templates SET ${sets.join(", ")}
         WHERE id = $${values.length}
         RETURNING id, title, description, action_type, target_count, xp_reward, coin_reward,
                   category, icon, plan_required, track, feature_key, is_active`,
        values
      );

      try {
        await db.query(
          `INSERT INTO admin_audit_log (admin_id, action, resource, resource_id, before_val, after_val, created_at)
           VALUES ($1, 'update_quest_template', 'quest_templates', $2, $3::jsonb, $4::jsonb, NOW())`,
          [auth.user.sub, id, JSON.stringify(existing), JSON.stringify(rows[0])]
        );
      } catch (auditErr) {
        logger.error({ err: auditErr, questId: id }, "[admin:quests] Failed to write admin_audit_log entry (non-fatal)");
      }

      return NextResponse.json({ success: true, data: { quest: rows[0] }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
