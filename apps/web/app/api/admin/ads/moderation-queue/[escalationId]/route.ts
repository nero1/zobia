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
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

    // NOTE: `ad_ai_escalations` / `ad_campaigns` are not present in
    // lib/db/schema.ts (schema/DB mismatch — reported upstream), so this
    // uses Drizzle's `sql` tag directly rather than the query builder.
    const orm = await getDb();
    const escalationResult = await orm.execute<{
      id: string;
      campaign_id: string;
      status: string;
      created_by: string;
      campaign_name: string;
    }>(sql`
      SELECT e.id, e.campaign_id, e.status, c.created_by, c.name AS campaign_name
      FROM ad_ai_escalations e
      JOIN ad_campaigns c ON c.id = e.campaign_id
      WHERE e.id = ${escalationId}
      LIMIT 1
    `);
    const escalation = escalationResult.rows[0];
    if (!escalation) throw notFound("Escalation not found");
    if (escalation.status !== "pending") {
      throw badRequest(`Escalation is already ${escalation.status}.`);
    }

    const approve = body.action === "approve";
    const newStatus = approve ? "approved" : "rejected";

    await orm.execute(sql`
      UPDATE ad_ai_escalations SET status = ${newStatus}, reviewed_by = ${auth.user.sub}, reviewed_at = NOW(), review_note = ${body.note ?? null} WHERE id = ${escalationId}
    `);

    // Any other creative on this campaign still needing review? If not, the
    // campaign-level moderation decision follows this one — same approve/
    // reject semantics as the general admin ads moderation queue.
    const remainingResult = await orm.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count FROM ad_ai_escalations WHERE campaign_id = ${escalation.campaign_id} AND status = 'pending'
    `);
    if (parseInt(remainingResult.rows[0]?.count ?? "0", 10) === 0) {
      await moderateCampaign(escalation.campaign_id, approve, auth.user.sub, body.note ?? null);

      await orm
        .insert(schema.notifications)
        .values({
          userId: escalation.created_by,
          type: "ad_campaign_moderated",
          title: approve ? "Ad campaign approved" : "Ad campaign rejected",
          body: approve
            ? `Your ad campaign "${escalation.campaign_name}" is now approved and ready to activate.`
            : `Your ad campaign "${escalation.campaign_name}" was rejected after human review.${body.note ? ` Reason: ${body.note}` : ""}`,
          metadata: { campaignId: escalation.campaign_id, moderationStatus: approve ? "approved" : "rejected" },
          isRead: false,
        })
        .catch((err) => logger.error({ err }, "[ads/moderation-queue] failed to notify advertiser"));
    }

    await orm
      .insert(schema.adminAuditLog)
      .values({
        adminId: auth.user.sub,
        action: `ad_image_escalation_${body.action}`,
        resource: "ad_ai_escalation",
        resourceId: escalationId,
        afterVal: { note: body.note ?? null, campaignId: escalation.campaign_id },
      })
      .catch((err) => logger.error({ err }, "[ads/moderation-queue] failed to write admin_audit_log"));

    return NextResponse.json({ success: true, data: { escalationId, status: approve ? "approved" : "rejected" }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
