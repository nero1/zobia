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
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

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

    const orm = await getDb();
    const conditions = [isNull(schema.adCampaigns.deletedAt)];
    if (moderationStatus) conditions.push(eq(schema.adCampaigns.moderationStatus, moderationStatus));

    const rows = await orm
      .select({
        campaign: schema.adCampaigns,
        advertiser_name: sql<string>`COALESCE(${schema.businessAccounts.businessName}, 'Zobia (Admin)')`,
      })
      .from(schema.adCampaigns)
      .leftJoin(schema.businessAccounts, eq(schema.businessAccounts.id, schema.adCampaigns.businessAccountId))
      .where(and(...conditions))
      .orderBy(desc(schema.adCampaigns.createdAt))
      .limit(200);

    const campaigns = rows.map((r) => ({ ...r.campaign, advertiser_name: r.advertiser_name }));

    return NextResponse.json({ success: true, data: { campaigns }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }: { auth: AdminContext }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, createSchema);

    const orm = await getDb();
    const [campaign] = await orm
      .insert(schema.adCampaigns)
      .values({
        ownerType: "admin",
        createdBy: auth.user.sub,
        name: body.name,
        objective: body.objective,
        status: "draft",
        moderationStatus: "approved",
        moderationMode: "manual",
        moderatedBy: auth.user.sub,
        moderatedAt: new Date(),
        cpmCredits: body.cpmCredits != null ? String(body.cpmCredits) : "500",
        totalBudgetCredits: String(body.totalBudgetCredits),
        targetPlans: body.targetPlans ?? null,
      })
      .returning();

    return NextResponse.json({ success: true, data: { campaign }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
