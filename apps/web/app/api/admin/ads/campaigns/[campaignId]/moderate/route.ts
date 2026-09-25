export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ads/campaigns/[campaignId]/moderate/route.ts
 *
 * POST /api/admin/ads/campaigns/:campaignId/moderate
 *   Body: { action: "approve" | "reject", reason?: string }
 *
 * Mirrors app/api/admin/sponsored-quests/[questId]/moderate exactly:
 * approve/reject a pending business-submitted campaign, notify the
 * submitter, write an admin_audit_log entry.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { moderateCampaign } from "@/lib/ads/repo";

interface Ctx {
  params: Promise<{ campaignId: string }>;
  auth: AdminContext;
}

const bodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().max(500).optional(),
});

export const POST = withAdminAuth(async (req: NextRequest, { params, auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { campaignId } = await params;
    const body = await validateBody(req, bodySchema);

    const orm = await getDb();

    const [campaign] = await orm
      .select({
        id: schema.adCampaigns.id,
        name: schema.adCampaigns.name,
        created_by: schema.adCampaigns.createdBy,
        moderation_status: schema.adCampaigns.moderationStatus,
      })
      .from(schema.adCampaigns)
      .where(and(eq(schema.adCampaigns.id, campaignId), isNull(schema.adCampaigns.deletedAt)))
      .limit(1);
    if (!campaign) throw notFound("Ad campaign not found");
    if (campaign.moderation_status !== "pending") {
      throw badRequest(`Campaign is already ${campaign.moderation_status}.`);
    }

    const approve = body.action === "approve";
    await moderateCampaign(campaignId, approve, auth.user.sub, body.reason ?? null);

    await orm
      .insert(schema.notifications)
      .values({
        userId: campaign.created_by,
        type: "ad_campaign_moderated",
        title: approve ? "Ad campaign approved" : "Ad campaign rejected",
        body: approve
          ? `Your ad campaign "${campaign.name}" is now approved and ready to activate.`
          : `Your ad campaign "${campaign.name}" was rejected.${body.reason ? ` Reason: ${body.reason}` : ""}`,
        metadata: { campaignId, moderationStatus: approve ? "approved" : "rejected" },
        isRead: false,
      })
      .catch(() => {});

    await orm
      .insert(schema.adminAuditLog)
      .values({
        adminId: auth.user.sub,
        action: `ad_campaign_${body.action}`,
        resource: "ad_campaign",
        resourceId: campaignId,
        afterVal: { reason: body.reason ?? null },
      })
      .catch(() => {});

    return NextResponse.json({ success: true, data: { campaignId, moderationStatus: approve ? "approved" : "rejected" }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
