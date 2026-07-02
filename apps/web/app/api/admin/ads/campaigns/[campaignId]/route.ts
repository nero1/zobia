export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ads/campaigns/[campaignId]/route.ts
 *
 * PATCH /api/admin/ads/campaigns/:campaignId — admin run-state control
 * (activate/pause/stop) for any campaign, and direct budget top-up for
 * admin-owned campaigns (no coin_ledger debit — platform-funded).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import type { AdCampaignRow } from "@/lib/ads/repo";

interface Ctx {
  params: Promise<{ campaignId: string }>;
  auth: AdminContext;
}

const patchSchema = z.object({
  action: z.enum(["activate", "pause", "stop"]).optional(),
  addBudgetCredits: z.number().int().positive().max(1_000_000_000).optional(),
});

export const PATCH = withAdminAuth(async (req: NextRequest, { params, auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { campaignId } = await params;
    const body = await validateBody(req, patchSchema);

    const { rows: existing } = await db.query<AdCampaignRow>(
      `SELECT * FROM ad_campaigns WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [campaignId]
    );
    if (!existing[0]) throw notFound("Campaign not found");
    if (!body.action && !body.addBudgetCredits) throw badRequest("Nothing to update");

    if (body.addBudgetCredits) {
      await db.query(
        `UPDATE ad_campaigns SET total_budget_credits = total_budget_credits + $1, updated_at = NOW() WHERE id = $2`,
        [body.addBudgetCredits, campaignId]
      );
    }
    if (body.action) {
      if (existing[0].moderation_status !== "approved") throw badRequest("Campaign must be approved before it can run.");
      const state = body.action === "activate" ? "active" : body.action === "pause" ? "paused" : "stopped";
      await db.query(`UPDATE ad_campaigns SET status = $1, updated_at = NOW() WHERE id = $2`, [state, campaignId]);
    }

    const { rows } = await db.query<AdCampaignRow>(`SELECT * FROM ad_campaigns WHERE id = $1`, [campaignId]);
    return NextResponse.json({ success: true, data: { campaign: rows[0] }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
