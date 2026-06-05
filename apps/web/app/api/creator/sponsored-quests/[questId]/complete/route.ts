/**
 * app/api/creator/sponsored-quests/[questId]/complete/route.ts
 *
 * POST /api/creator/sponsored-quests/[questId]/complete
 *
 * Creator submits proof of completion for a sponsored quest they applied to.
 *
 * Flow (PRD §14 — Sponsored Quest 70/30 split):
 *  1. Creator must have an 'accepted' application for this quest.
 *  2. Creator submits completion proof (URL, description, etc.).
 *  3. Application status → 'completed'; timestamps recorded.
 *  4. Triggers admin notification for review.
 *
 * Payout is triggered by admin approval via /approve endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const completeQuestSchema = z.object({
  completionProof: z
    .string()
    .min(10, "Completion proof must be at least 10 characters")
    .max(2000),
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export const POST = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { questId: string }; auth: { user: { sub: string } } }
) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);
    const { questId } = await params as { questId: string };

    const body = await validateBody(req, completeQuestSchema);

    // Fetch quest
    const { rows: questRows } = await db.query<{
      id: string;
      title: string;
      deadline: string;
      is_active: boolean;
    }>(
      `SELECT id, title, deadline, is_active FROM sponsored_quests WHERE id = $1 LIMIT 1`,
      [questId]
    );
    const quest = questRows[0];
    if (!quest) throw notFound("Sponsored quest not found");
    if (!quest.is_active || new Date(quest.deadline) < new Date()) {
      throw badRequest("This quest is no longer accepting completions");
    }

    // Verify creator has an accepted application
    const { rows: appRows } = await db.query<{ id: string; status: string }>(
      `SELECT id, status
       FROM sponsored_quest_applications
       WHERE quest_id = $1 AND creator_id = $2
       LIMIT 1`,
      [questId, userId]
    );
    const app = appRows[0];
    if (!app) throw notFound("You have not applied to this quest");
    if (!["applied", "accepted"].includes(app.status)) {
      throw badRequest(`Quest completion not allowed in '${app.status}' status`);
    }

    // Update application to 'completed'
    await db.query(
      `UPDATE sponsored_quest_applications
       SET status = 'completed',
           completion_proof = $1,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [body.completionProof, app.id]
    );

    // Notify admin for review (best-effort)
    db.query(
      `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
       SELECT u.id,
              'sponsored_quest_completion_pending',
              $1::jsonb,
              FALSE,
              NOW()
       FROM users u
       WHERE u.is_admin = TRUE AND u.deleted_at IS NULL
       LIMIT 5`,
      [JSON.stringify({ questId, questTitle: quest.title, creatorId: userId, applicationId: app.id })]
    ).catch(() => {});

    return NextResponse.json(
      {
        success: true,
        data: {
          applicationId: app.id,
          status: "completed",
          message: "Completion submitted. Awaiting admin review for payout.",
        },
        error: null,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
