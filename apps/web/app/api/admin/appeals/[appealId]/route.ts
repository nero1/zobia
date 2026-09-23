export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/appeals/[appealId]
 *
 * Admin/moderator: approve or deny an account (suspension/ban) appeal.
 *
 *   approve — lifts the suspension/ban by calling the exact same restore
 *             logic used by the direct admin "restore" action
 *             (lib/moderation/accountActions.ts — see
 *             app/api/admin/users/[userId]/actions/route.ts).
 *   deny    — increments the appeal's refusal_count. Once a user's denied
 *             appeals for this appeal_type reach x_manifest
 *             appeals.maxRefusals, POST /api/appeals refuses further
 *             submissions for that suspension/ban (enforced at submission
 *             time, not here).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { restoreUserAccount } from "@/lib/moderation/accountActions";

interface AppealActionParams {
  appealId: string;
}

interface AppealRow {
  id: string;
  user_id: string;
  appeal_type: string;
  status: string;
  refusal_count: number;
}

const ActionSchema = z.object({
  action: z.enum(["approve", "deny"]),
  adminNotes: z.string().max(2000).optional().nullable(),
});

export const PATCH = withAdminAuth<AppealActionParams>(async (req, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { appealId } = params;
    const body = await validateBody(req, ActionSchema);

    const result = await db.transaction(async (client) => {
      const { rows } = await client.query<AppealRow>(
        `SELECT id, user_id, appeal_type, status, refusal_count
         FROM account_appeals WHERE id = $1 FOR UPDATE`,
        [appealId]
      );
      const appeal = rows[0];
      if (!appeal) throw notFound("Appeal not found");
      if (appeal.status !== "pending" && appeal.status !== "under_review") {
        throw conflict(`Appeal has already been ${appeal.status}`, "APPEAL_ALREADY_RESOLVED");
      }

      if (body.action === "approve") {
        // Same unban/unsuspend logic as the direct admin "restore" action —
        // reused, not duplicated (see lib/moderation/accountActions.ts).
        await restoreUserAccount(client, appeal.user_id);

        await client.query(
          `UPDATE account_appeals
           SET status = 'approved', admin_notes = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
           WHERE id = $3`,
          [body.adminNotes ?? null, auth.user.sub, appealId]
        );

        await client.query(
          `INSERT INTO admin_actions (admin_id, target_user_id, action, reason, created_at)
           VALUES ($1, $2, 'restore', $3, NOW())`,
          [auth.user.sub, appeal.user_id, `Appeal ${appealId} approved`]
        );
      } else {
        const newRefusalCount = appeal.refusal_count + 1;
        await client.query(
          `UPDATE account_appeals
           SET status = 'denied', refusal_count = $1, admin_notes = $2,
               reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
           WHERE id = $4`,
          [newRefusalCount, body.adminNotes ?? null, auth.user.sub, appealId]
        );
      }

      return { appealType: appeal.appeal_type, userId: appeal.user_id };
    });

    return NextResponse.json({
      success: true,
      data: { appealId, action: body.action, appealType: result.appealType },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
