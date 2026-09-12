export const dynamic = 'force-dynamic';

/**
 * app/api/quests/owned/route.ts
 *
 * GET /api/quests/owned — Sponsored Quests where the caller is the
 * admin-assigned "creator"/campaign manager (sponsored_quests.owner_user_id).
 * Backs the /quests/manage panel: stats + campaign progress. The owner can
 * revive/extend/add budget (see [questId]/route.ts PATCH) but never edit
 * the quest's public-facing details — that stays admin-only
 * (app/api/admin/sponsored-quests) to keep moderation meaningful.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface OwnedQuestRow {
  id: string;
  brand_name: string;
  title: string;
  description: string;
  reward_coins: number;
  is_active: boolean;
  moderation_status: string;
  moderation_reason: string | null;
  auto_paused: boolean;
  pause_reason: string | null;
  flag_status: string;
  is_daily_quest_eligible: boolean;
  starts_at: string | null;
  ends_at: string | null;
  deadline: string;
  total_budget_credits: string;
  spent_credits: string;
  daily_budget_credits: string | null;
  estimated_reach: number | null;
  impressions_count: number;
  completions_count: number;
  application_count: number;
  approved_count: number;
  created_at: string;
}

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { rows } = await db.query<OwnedQuestRow>(
      `SELECT sq.id, sq.brand_name, sq.title, sq.description, sq.reward_coins,
              sq.is_active, sq.moderation_status, sq.moderation_reason,
              sq.auto_paused, sq.pause_reason, sq.flag_status, sq.is_daily_quest_eligible,
              sq.starts_at, sq.ends_at, sq.deadline, sq.total_budget_credits, sq.spent_credits,
              sq.daily_budget_credits, sq.estimated_reach, sq.impressions_count, sq.completions_count,
              sq.created_at,
              COUNT(sqa.id)::int AS application_count,
              COUNT(sqa.id) FILTER (WHERE sqa.status = 'approved')::int AS approved_count
       FROM sponsored_quests sq
       LEFT JOIN sponsored_quest_applications sqa ON sqa.quest_id = sq.id
       WHERE sq.owner_user_id = $1 AND sq.deleted_at IS NULL
       GROUP BY sq.id
       ORDER BY sq.created_at DESC`,
      [auth.user.sub]
    );

    return NextResponse.json({ success: true, data: { quests: rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
