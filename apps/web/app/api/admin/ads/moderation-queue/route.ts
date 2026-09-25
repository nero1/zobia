export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ads/moderation-queue/route.ts
 *
 * GET /api/admin/ads/moderation-queue?status=pending
 *
 * The Ad Moderator review queue: ad creative images that neither DeepSeek
 * (primary) nor Gemini (fallback/escalation) could confidently classify
 * (see lib/ai/vision.ts, lib/moderation/aiClassifier.ts
 * classifyAdCreativeImage, lib/ads/repo.ts submitCampaignForModeration).
 *
 * Accessible to is_admin OR is_ad_moderator (a narrower staff role — see
 * lib/auth/roles.ts) — unlike every other /api/admin/ads/** route, which is
 * admin-only.
 *
 * NOTE: `ad_ai_escalations` has no Drizzle schema entry (lib/db/schema.ts
 * only defines the unrelated `moderation_ai_escalations` table) — this is a
 * genuine schema gap. Kept as a raw SQL string executed via
 * `orm.execute(sql...)` (getDb()'s underlying pg pool), rather than
 * `db.query`, until that table is added to the Drizzle schema.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { withAdModeratorOrAdminAuth, type AdModeratorContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface Ctx {
  params: Promise<Record<string, never>>;
  auth: AdModeratorContext;
}

const querySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional().default("pending"),
});

export interface AdAiEscalationRow {
  id: string;
  campaign_id: string;
  campaign_name: string;
  advertiser_name: string | null;
  creative_id: string | null;
  image_url: string;
  deepseek_result: Record<string, unknown> | null;
  gemini_result: Record<string, unknown> | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_by_username: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

export const GET = withAdModeratorOrAdminAuth(async (req: NextRequest, { auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { searchParams } = new URL(req.url);
    const { status } = querySchema.parse({ status: searchParams.get("status") ?? undefined });

    const orm = await getDb();
    const result = await orm.execute(sql`
      SELECT e.id, e.campaign_id, c.name AS campaign_name,
             COALESCE(bp.name, ba.business_name, u.display_name, u.username) AS advertiser_name,
             e.creative_id, e.image_url, e.deepseek_result, e.gemini_result,
             e.status, e.reviewed_by, ru.username AS reviewed_by_username,
             e.reviewed_at, e.review_note, e.created_at
      FROM ad_ai_escalations e
      JOIN ad_campaigns c ON c.id = e.campaign_id
      LEFT JOIN business_pages bp ON bp.id = c.business_page_id
      LEFT JOIN business_accounts ba ON ba.id = c.business_account_id
      LEFT JOIN users u ON u.id = COALESCE(c.advertiser_user_id, c.created_by)
      LEFT JOIN users ru ON ru.id = e.reviewed_by
      WHERE e.status = ${status}
      ORDER BY e.created_at ASC
      LIMIT 200
    `);

    return NextResponse.json({ success: true, data: { escalations: result.rows as unknown as AdAiEscalationRow[] }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
