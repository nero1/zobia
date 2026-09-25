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
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
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

    // NOTE: `ad_campaigns` is not present in lib/db/schema.ts (schema/DB
    // mismatch — reported upstream), so this uses Drizzle's `sql` tag
    // directly rather than the query builder.
    const orm = await getDb();
    const existingResult = await orm.execute(sql`
      SELECT * FROM ad_campaigns WHERE id = ${campaignId} AND deleted_at IS NULL LIMIT 1
    `);
    const existing = existingResult.rows[0] as unknown as AdCampaignRow | undefined;
    if (!existing) throw notFound("Campaign not found");
    if (!body.action && !body.addBudgetCredits) throw badRequest("Nothing to update");

    if (body.addBudgetCredits) {
      await orm.execute(sql`
        UPDATE ad_campaigns SET total_budget_credits = total_budget_credits + ${body.addBudgetCredits}, updated_at = NOW() WHERE id = ${campaignId}
      `);
    }
    if (body.action) {
      if (existing.moderation_status !== "approved") throw badRequest("Campaign must be approved before it can run.");
      const state = body.action === "activate" ? "active" : body.action === "pause" ? "paused" : "stopped";
      await orm.execute(sql`UPDATE ad_campaigns SET status = ${state}, updated_at = NOW() WHERE id = ${campaignId}`);
    }

    const result = await orm.execute(sql`SELECT * FROM ad_campaigns WHERE id = ${campaignId}`);
    return NextResponse.json({ success: true, data: { campaign: result.rows[0] as unknown as AdCampaignRow }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
