export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ads/campaigns/[campaignId]/creatives/route.ts
 *
 * POST /api/admin/ads/campaigns/:campaignId/creatives — attach a creative
 * to any campaign (business- or admin-owned). Unlike the business-facing
 * creatives route, admins may use format "third_party" (raw ad network
 * tag) — the injected-script trust boundary is admin-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface Ctx {
  params: Promise<{ campaignId: string }>;
  auth: AdminContext;
}

const createSchema = z.object({
  placementKey: z.string().min(1).max(50),
  format: z.enum(["html", "text", "image", "native", "third_party"]),
  size: z.enum(["300x250", "320x50", "interstitial", "rewarded", "native"]),
  title: z.string().max(150).optional(),
  body: z.string().max(2000).optional(),
  imageUrl: z.string().url().max(1000).optional(),
  clickUrl: z.string().url().max(1000).optional(),
  thirdPartyTag: z.string().max(20000).optional(),
  ctaLabel: z.string().max(40).optional(),
});

export const POST = withAdminAuth(async (req: NextRequest, { params, auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { campaignId } = await params;
    const body = await validateBody(req, createSchema);

    // NOTE: `ad_campaigns` / `ad_creatives` are not present in
    // lib/db/schema.ts (schema/DB mismatch — reported upstream), so this
    // uses Drizzle's `sql` tag directly rather than the query builder.
    const orm = await getDb();
    const campaignResult = await orm.execute<{ id: string }>(sql`
      SELECT id FROM ad_campaigns WHERE id = ${campaignId} AND deleted_at IS NULL LIMIT 1
    `);
    if (!campaignResult.rows[0]) throw notFound("Campaign not found");

    const result = await orm.execute(sql`
      INSERT INTO ad_creatives (campaign_id, placement_key, format, size, title, body, image_url, click_url, third_party_tag, cta_label)
      VALUES (${campaignId}, ${body.placementKey}, ${body.format}, ${body.size}, ${body.title ?? null}, ${body.body ?? null}, ${body.imageUrl ?? null}, ${body.clickUrl ?? null}, ${body.thirdPartyTag ?? null}, ${body.ctaLabel ?? null})
      RETURNING *
    `);

    return NextResponse.json({ success: true, data: { creative: result.rows[0] }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
