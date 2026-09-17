export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ads/moderation-queue/[escalationId]/route.ts
 *
 * POST — an Ad Moderator (or admin) resolves one escalated ad creative
 * image: approve or reject it. Approving/rejecting the escalation also
 * resolves the parent campaign's moderation decision when this was its
 * only pending item (mirrors app/api/admin/ads/campaigns/:id/moderate).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdModeratorOrAdminAuth, validateBody, type AdModeratorContext } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { moderateCampaign } from "@/lib/ads/repo";
import { logger } from "@/lib/logger";

interface Ctx {
  params: Promise<{ escalationId: string }>;
  auth: AdModeratorContext;
}

const bodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().max(500).optional(),
});

export const POST = withAdModeratorOrAdminAuth(async (req: NextRequest, { params, auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { escalationId } = await params;
    const body = await validateBody(req, bodySchema);

    const { rows } = await db.query<{ id: string; campaign_id: string; status: string; created_by: string; campaign_name: string }>(
      `SELECT e.id, e.campaign_id, e.status, c.created_by, c.name AS campaign_name
       FROM ad_ai_escalations e
       JOIN ad_campaigns c ON c.id = e.campaign_id
       WHERE e.id = $1
       LIMIT 1`,
      [escalationId]
    );
    const escalation = rows[0];
    if (!escalation) throw notFound("Escalation not found");
    if (escalation.status !== "pending") {
      throw badRequest(`Escalation is already ${escalation.status}.`);
    }

    const approve = body.action === "approve";

    await db.query(
      `UPDATE ad_ai_escalations SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_note = $3 WHERE id = $4`,
      [approve ? "approved" : "rejected", auth.user.sub, body.note ?? null, escalationId]
    );

    // Any other creative on this campaign still needing review? If not, the
    // campaign-level moderation decision follows this one — same approve/
    // reject semantics as the general admin ads moderation queue.
    const { rows: remaining } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ad_ai_escalations WHERE campaign_id = $1 AND status = 'pending'`,
      [escalation.campaign_id]
    );
    if (parseInt(remaining[0]?.count ?? "0", 10) === 0) {
      await moderateCampaign(escalation.campaign_id, approve, auth.user.sub, body.note ?? null);

      await db
        .query(
          `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
           VALUES ($1, 'ad_campaign_moderated', $2, $3, $4::jsonb, false, NOW())`,
          [
            escalation.created_by,
            approve ? "Ad campaign approved" : "Ad campaign rejected",
            approve
              ? `Your ad campaign "${escalation.campaign_name}" is now approved and ready to activate.`
              : `Your ad campaign "${escalation.campaign_name}" was rejected after human review.${body.note ? ` Reason: ${body.note}` : ""}`,
            JSON.stringify({ campaignId: escalation.campaign_id, moderationStatus: approve ? "approved" : "rejected" }),
          ]
        )
        .catch((err) => logger.error({ err }, "[ads/moderation-queue] failed to notify advertiser"));
    }

    await db
      .query(
        `INSERT INTO admin_audit_log (admin_id, action, resource, resource_id, after_val, created_at)
         VALUES ($1, $2, 'ad_ai_escalation', $3, $4::jsonb, NOW())`,
        [auth.user.sub, `ad_image_escalation_${body.action}`, escalationId, JSON.stringify({ note: body.note ?? null, campaignId: escalation.campaign_id })]
      )
      .catch((err) => logger.error({ err }, "[ads/moderation-queue] failed to write admin_audit_log"));

    return NextResponse.json({ success: true, data: { escalationId, status: approve ? "approved" : "rejected" }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
