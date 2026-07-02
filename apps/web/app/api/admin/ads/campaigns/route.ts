export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ads/campaigns/route.ts
 *
 * GET  /api/admin/ads/campaigns?moderationStatus=pending — moderation queue
 *      (mirrors app/api/admin/sponsored-quests). Defaults to all campaigns.
 * POST /api/admin/ads/campaigns — admin-authored ad (owner_type='admin',
 *      no Business Account required, auto-approved and immediately usable
 *      once a creative is attached and it's activated).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import type { AdCampaignRow } from "@/lib/ads/repo";

const createSchema = z.object({
  name: z.string().min(3).max(150),
  objective: z.enum(["awareness", "traffic", "boost_post", "boost_room"]).default("awareness"),
  cpmCredits: z.number().positive().max(1_000_000).optional(),
  totalBudgetCredits: z.number().int().nonnegative().max(1_000_000_000).default(0),
  targetPlans: z.array(z.enum(["free", "plus", "pro", "max"])).max(4).optional(),
});

export const GET = withAdminAuth(async (req: NextRequest, { auth }: { auth: AdminContext }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const moderationStatus = req.nextUrl.searchParams.get("moderationStatus");

    const { rows } = await db.query<AdCampaignRow & { advertiser_name: string | null }>(
      `SELECT c.*, COALESCE(ba.business_name, 'Zobia (Admin)') AS advertiser_name
       FROM ad_campaigns c
       LEFT JOIN business_accounts ba ON ba.id = c.business_account_id
       WHERE c.deleted_at IS NULL ${moderationStatus ? "AND c.moderation_status = $1" : ""}
       ORDER BY c.created_at DESC
       LIMIT 200`,
      moderationStatus ? [moderationStatus] : []
    );

    return NextResponse.json({ success: true, data: { campaigns: rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }: { auth: AdminContext }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, createSchema);

    const { rows } = await db.query<AdCampaignRow>(
      `INSERT INTO ad_campaigns
         (owner_type, created_by, name, objective, status, moderation_status, moderation_mode,
          moderated_by, moderated_at, cpm_credits, total_budget_credits, target_plans)
       VALUES ('admin', $1, $2, $3, 'draft', 'approved', 'manual', $1, NOW(), COALESCE($4, 500), $5, $6)
       RETURNING *`,
      [auth.user.sub, body.name, body.objective, body.cpmCredits ?? null, body.totalBudgetCredits, body.targetPlans ?? null]
    );

    return NextResponse.json({ success: true, data: { campaign: rows[0] }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
