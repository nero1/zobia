export const dynamic = 'force-dynamic';

/**
 * app/api/business/sponsored-quests/[questId]/route.ts
 *
 * PATCH  — edit a pending/rejected submission (re-submits for moderation).
 *          Approved/live quests cannot be edited here — cancel and
 *          resubmit instead, since applications may already be in flight.
 * DELETE — cancel a submission (soft-delete, applications untouched).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import type { SqlParam } from "@/lib/db";
import { withAuth, validateBody, type AuthContext } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getSponsoredQuestModerationMode } from "@/lib/business/limits";

interface Ctx {
  params: Promise<{ questId: string }>;
  auth: AuthContext;
}

const updateSchema = z.object({
  title: z.string().min(3).max(150).optional(),
  description: z.string().min(10).max(2000).optional(),
  requirements: z.string().min(10).max(2000).optional(),
  rewardCoins: z.number().int().positive().optional(),
  maxApplications: z.number().int().positive().max(1000).optional(),
  deadline: z.string().datetime().optional(),
});

async function assertOwnedPendingOrRejected(questId: string, userId: string) {
  const { rows } = await db.query<{ id: string; business_account_id: string | null; owner_user_id: string; moderation_status: string }>(
    `SELECT sq.id, sq.business_account_id, ba.user_id AS owner_user_id, sq.moderation_status
     FROM sponsored_quests sq
     JOIN business_accounts ba ON ba.id = sq.business_account_id
     WHERE sq.id = $1 AND sq.deleted_at IS NULL LIMIT 1`,
    [questId]
  );
  const quest = rows[0];
  if (!quest || quest.owner_user_id !== userId) throw notFound("Sponsored quest not found");
  return quest;
}

export const PATCH = withAuth(async (req: NextRequest, { params, auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { questId } = await params;
    const quest = await assertOwnedPendingOrRejected(questId, auth.user.sub);
    if (quest.moderation_status === "approved") {
      throw forbidden("Live Sponsored Quests cannot be edited — cancel and resubmit instead.", "SPONSORED_QUEST_LIVE");
    }

    const body = await validateBody(req, updateSchema);
    if (body.deadline && new Date(body.deadline) <= new Date()) {
      throw badRequest("deadline must be in the future");
    }

    const setParts: string[] = ["updated_at = NOW()", "moderation_status = 'pending'", "moderation_reason = NULL", "is_active = FALSE"];
    const values: SqlParam[] = [questId];
    let idx = 2;
    const fieldMap: Record<string, string> = {
      title: "title",
      description: "description",
      requirements: "requirements",
      rewardCoins: "reward_coins",
      maxApplications: "max_applications",
      deadline: "deadline",
    };
    for (const [jsKey, col] of Object.entries(fieldMap)) {
      const val = (body as Record<string, unknown>)[jsKey];
      if (val !== undefined) {
        setParts.push(`${col} = $${idx++}`);
        values.push(val as SqlParam);
      }
    }

    await db.query(`UPDATE sponsored_quests SET ${setParts.join(", ")} WHERE id = $1`, values);

    return NextResponse.json({
      success: true,
      data: { questId, moderationStatus: "pending", mode: await getSponsoredQuestModerationMode() },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth(async (_req: NextRequest, { params, auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { questId } = await params;
    await assertOwnedPendingOrRejected(questId, auth.user.sub);

    await db.query(
      `UPDATE sponsored_quests SET deleted_at = NOW(), is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [questId]
    );

    return NextResponse.json({ success: true, data: { questId, deleted: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
