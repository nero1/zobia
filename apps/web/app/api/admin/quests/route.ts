export const dynamic = 'force-dynamic';

/**
 * app/api/admin/quests/route.ts
 *
 * Admin Quests catalog — the base list of quest_templates rows that feed
 * lib/quests/questEngine.ts generateDailyDeck(). Distinct from the two
 * narrower quest-admin surfaces that already exist:
 *   - /gate44/quests/boosts (quest_feature_boosts) — temporary campaign
 *     weighting of which FEATURE's quests show up more.
 *   - /gate44/sponsored-quests (sponsored_quests) — advertiser-funded
 *     quests, each of which upserts its own shadow quest_templates row
 *     (sponsored_quest_id NOT NULL) once opted into daily-deck rotation.
 * This page manages the "core" catalog instead — sponsored shadow rows are
 * excluded here and stay owned by the Sponsored Quests page.
 *
 * GET  /api/admin/quests — list all core quest templates with last-30-day
 *   assignment/completion stats.
 * POST /api/admin/quests — create a new quest template.
 *
 * Fields NOT editable from this API, and why:
 *   - action_type: a fixed vocabulary of strings that application code
 *     calls triggerActivityQuestProgress() with from ~20 call sites across
 *     the codebase (see QUEST_ACTION_TYPES in lib/quests/questEngine.ts).
 *     Creation constrains the picker to that known-wired vocabulary;
 *     editing it on an existing row would silently disconnect the quest
 *     from the feature that's supposed to advance it, so it's immutable
 *     after creation.
 *   - Deck size per plan (3/4/5/6) and the 500 XP full-deck completion
 *     bonus: genuinely hardcoded constants in questEngine.ts
 *     (DECK_SIZE_BY_PLAN / DECK_COMPLETION_BONUS_XP), not data. Surfaced
 *     read-only in the admin UI rather than faked as editable.
 *   - Sponsored-quest injection chance/CPM/daily slots: already
 *     admin-editable, but at /gate44/config (x_manifest questSystem.*
 *     keys) — surfaced here read-only with a link, not duplicated.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { logger } from "@/lib/logger";
import { QUEST_FEATURE_KEYS, QUEST_ACTION_TYPES, TRACK_COLUMN } from "@/lib/quests/questEngine";

const createSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().min(2).max(500),
  actionType: z.enum(QUEST_ACTION_TYPES as unknown as [string, ...string[]]),
  targetCount: z.number().int().positive().max(100000),
  xpReward: z.number().int().min(0).max(100000),
  coinReward: z.number().int().min(0).max(100000),
  category: z.string().min(1).max(60).default("general"),
  icon: z.string().max(8).optional().nullable(),
  planRequired: z.enum(["free", "plus", "pro", "max"]).default("free"),
  track: z.enum(Object.keys(TRACK_COLUMN) as [string, ...string[]]).default("main"),
  featureKey: z.enum(QUEST_FEATURE_KEYS as unknown as [string, ...string[]]).optional().nullable(),
});

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
  valid_date: string | null;
  created_at: string;
  assigned_count: string;
  completed_count: string;
}

export const GET = withAdminAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { rows } = await db.query<QuestTemplateRow>(
      `SELECT qt.id, qt.title, qt.description, qt.action_type, qt.target_count,
              qt.xp_reward, qt.coin_reward, qt.category, qt.icon, qt.plan_required,
              qt.track, qt.feature_key, qt.is_active, qt.valid_date, qt.created_at,
              COALESCE(stats.assigned_count, 0) AS assigned_count,
              COALESCE(stats.completed_count, 0) AS completed_count
       FROM quest_templates qt
       LEFT JOIN (
         SELECT uqd.quest_id,
                COUNT(*) AS assigned_count,
                COUNT(*) FILTER (WHERE uqp.completed) AS completed_count
         FROM user_quest_decks uqd
         LEFT JOIN user_quest_progress uqp
           ON uqp.user_id = uqd.user_id
          AND uqp.quest_id = uqd.quest_id
          AND uqp.quest_date = uqd.assigned_date
         WHERE uqd.assigned_date >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY uqd.quest_id
       ) stats ON stats.quest_id = qt.id
       WHERE qt.sponsored_quest_id IS NULL
       ORDER BY qt.category ASC, qt.title ASC`
    );

    return NextResponse.json({
      success: true,
      data: {
        quests: rows,
        featureKeys: QUEST_FEATURE_KEYS,
        actionTypes: QUEST_ACTION_TYPES,
        tracks: Object.keys(TRACK_COLUMN),
        statsWindowDays: 30,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, createSchema);

    const { rows: existing } = await db.query<{ id: string }>(
      `SELECT id FROM quest_templates WHERE title = $1 LIMIT 1`,
      [body.title]
    );
    if (existing[0]) {
      throw conflict(`A quest template titled "${body.title}" already exists`);
    }

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO quest_templates
         (title, description, action_type, target_count, xp_reward, coin_reward,
          category, icon, plan_required, track, feature_key, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
       RETURNING id`,
      [
        body.title,
        body.description,
        body.actionType,
        body.targetCount,
        body.xpReward,
        body.coinReward,
        body.category,
        body.icon ?? null,
        body.planRequired,
        body.track,
        body.featureKey ?? null,
      ]
    );

    try {
      await db.query(
        `INSERT INTO admin_audit_log (admin_id, action, resource, resource_id, before_val, after_val, created_at)
         VALUES ($1, 'create_quest_template', 'quest_templates', $2, NULL, $3::jsonb, NOW())`,
        [auth.user.sub, rows[0].id, JSON.stringify(body)]
      );
    } catch (auditErr) {
      logger.error({ err: auditErr, questId: rows[0].id }, "[admin:quests] Failed to write admin_audit_log entry (non-fatal)");
    }

    return NextResponse.json({ success: true, data: { id: rows[0].id }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
