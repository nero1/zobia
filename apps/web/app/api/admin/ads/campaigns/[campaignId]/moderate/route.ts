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
import { db } from "@/lib/db";
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

    const { rows } = await db.query<{ id: string; name: string; created_by: string; moderation_status: string }>(
      `SELECT id, name, created_by, moderation_status FROM ad_campaigns WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [campaignId]
    );
    const campaign = rows[0];
    if (!campaign) throw notFound("Ad campaign not found");
    if (campaign.moderation_status !== "pending") {
      throw badRequest(`Campaign is already ${campaign.moderation_status}.`);
    }

    const approve = body.action === "approve";
    await moderateCampaign(campaignId, approve, auth.user.sub, body.reason ?? null);

    await db
      .query(
        `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
         VALUES ($1, 'ad_campaign_moderated', $2, $3, $4::jsonb, false, NOW())`,
        [
          campaign.created_by,
          approve ? "Ad campaign approved" : "Ad campaign rejected",
          approve
            ? `Your ad campaign "${campaign.name}" is now approved and ready to activate.`
            : `Your ad campaign "${campaign.name}" was rejected.${body.reason ? ` Reason: ${body.reason}` : ""}`,
          JSON.stringify({ campaignId, moderationStatus: approve ? "approved" : "rejected" }),
        ]
      )
      .catch(() => {});

    await db
      .query(
        `INSERT INTO admin_audit_log (admin_id, action, resource, resource_id, after_val, created_at)
         VALUES ($1, $2, 'ad_campaign', $3, $4::jsonb, NOW())`,
        [auth.user.sub, `ad_campaign_${body.action}`, campaignId, JSON.stringify({ reason: body.reason ?? null })]
      )
      .catch(() => {});

    return NextResponse.json({ success: true, data: { campaignId, moderationStatus: approve ? "approved" : "rejected" }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
