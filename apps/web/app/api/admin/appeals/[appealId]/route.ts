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
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

    const orm = await getDb();

    const result = await orm.transaction(async (client) => {
      const [appealRow] = await client
        .select({
          id: schema.accountAppeals.id,
          userId: schema.accountAppeals.userId,
          appealType: schema.accountAppeals.appealType,
          status: schema.accountAppeals.status,
          refusalCount: schema.accountAppeals.refusalCount,
        })
        .from(schema.accountAppeals)
        .where(eq(schema.accountAppeals.id, appealId))
        .for("update");

      const appeal: AppealRow | undefined = appealRow
        ? {
            id: appealRow.id,
            user_id: appealRow.userId,
            appeal_type: appealRow.appealType,
            status: appealRow.status,
            refusal_count: appealRow.refusalCount,
          }
        : undefined;
      if (!appeal) throw notFound("Appeal not found");
      if (appeal.status !== "pending" && appeal.status !== "under_review") {
        throw conflict(`Appeal has already been ${appeal.status}`, "APPEAL_ALREADY_RESOLVED");
      }

      if (body.action === "approve") {
        // Same unban/unsuspend logic as the direct admin "restore" action —
        // reused, not duplicated (see lib/moderation/accountActions.ts).
        await restoreUserAccount(client, appeal.user_id);

        await client
          .update(schema.accountAppeals)
          .set({
            status: "approved",
            adminNotes: body.adminNotes ?? null,
            reviewedBy: auth.user.sub,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.accountAppeals.id, appealId));

        await client.insert(schema.adminActions).values({
          adminId: auth.user.sub,
          targetUserId: appeal.user_id,
          action: "restore",
          reason: `Appeal ${appealId} approved`,
        });
      } else {
        const newRefusalCount = appeal.refusal_count + 1;
        await client
          .update(schema.accountAppeals)
          .set({
            status: "denied",
            refusalCount: newRefusalCount,
            adminNotes: body.adminNotes ?? null,
            reviewedBy: auth.user.sub,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.accountAppeals.id, appealId));
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
