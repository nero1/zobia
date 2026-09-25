export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ads/campaigns/[campaignId]/revert-to-manual/route.ts
 *
 * POST — reverse an AI auto-approval decision on an ad campaign, sending it
 * back to the manual admin review queue (moderation_status='pending').
 * Surfaced from the Admin AI Monitoring panel (/gate44/ai-monitoring) so an
 * admin who disagrees with an AI auto-approve can pull it back for a human
 * look without waiting for a report against it. Campaign is paused/reset to
 * pending_review so it stops serving impressions while under re-review.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { logger } from "@/lib/logger";

interface Ctx {
  params: Promise<{ campaignId: string }>;
  auth: AdminContext;
}

const bodySchema = z.object({
  reason: z.string().max(500).optional(),
});

export const POST = withAdminAuth(async (req: NextRequest, { params, auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { campaignId } = await params;
    const body = await validateBody(req, bodySchema);

    // NOTE: `ad_campaigns` is not present in lib/db/schema.ts (schema/DB
    // mismatch — reported upstream), so this uses Drizzle's `sql` tag
    // directly rather than the query builder.
    const orm = await getDb();
    const campaignResult = await orm.execute<{
      id: string;
      name: string;
      created_by: string;
      moderation_status: string;
      moderation_mode: string | null;
    }>(sql`
      SELECT id, name, created_by, moderation_status, moderation_mode FROM ad_campaigns WHERE id = ${campaignId} AND deleted_at IS NULL LIMIT 1
    `);
    const campaign = campaignResult.rows[0];
    if (!campaign) throw notFound("Ad campaign not found");
    if (campaign.moderation_status !== "approved" || campaign.moderation_mode !== "ai") {
      throw badRequest("Only an AI-approved campaign can be reverted to manual review.");
    }

    const reason = body.reason ?? "Reverted from AI auto-approval for manual re-review.";
    await orm.execute(sql`
      UPDATE ad_campaigns
      SET status = 'pending_review', moderation_status = 'pending', moderation_reason = ${reason}, updated_at = NOW()
      WHERE id = ${campaignId}
    `);

    await orm
      .insert(schema.notifications)
      .values({
        userId: campaign.created_by,
        type: "ad_campaign_moderated",
        title: "Ad campaign under re-review",
        body: `Your ad campaign "${campaign.name}" was pulled back for a manual review.${body.reason ? ` Reason: ${body.reason}` : ""}`,
        metadata: { campaignId, moderationStatus: "pending" },
        isRead: false,
      })
      .catch((err) => logger.error({ err }, "[ads/revert-to-manual] failed to notify advertiser"));

    await orm
      .insert(schema.adminAuditLog)
      .values({
        adminId: auth.user.sub,
        action: "ad_campaign_ai_decision_reverted",
        resource: "ad_campaign",
        resourceId: campaignId,
        afterVal: { reason: body.reason ?? null },
      })
      .catch((err) => logger.error({ err }, "[ads/revert-to-manual] failed to write admin_audit_log"));

    return NextResponse.json({ success: true, data: { campaignId, moderationStatus: "pending" }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
