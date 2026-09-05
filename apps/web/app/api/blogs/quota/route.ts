export const dynamic = "force-dynamic";

/**
 * app/api/blogs/quota/route.ts
 *
 * GET /api/blogs/quota — the caller's blog-slot quota status, consumed by
 * the "Start a Blog" web form so it can mirror the same
 * quota/payment logic POST /api/blogs (lib/blogs/service.ts's createBlog)
 * actually enforces, instead of guessing at it client-side. Reports:
 *  - the personal scope's plan, included quota, used count and remaining
 *  - the caller's own business account (if any) and its included/used/
 *    remaining, additive to the personal quota (migration 0018)
 *  - the admin-configurable extra-slot Credits/Stars cost for each scope,
 *    so the client never hardcodes a price.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";
import { countActiveBlogsForScope } from "@/lib/blogs/repo";
import {
  getIncludedPersonalBlogCount,
  getIncludedBusinessBlogCount,
  getExtraBlogSlotCost,
  type BlogExtraSlotCost,
} from "@/lib/blogs/limits";

interface ScopeQuota {
  used: number;
  included: number;
  remaining: number;
  atCapacity: boolean;
}

function toScope(used: number, included: number): ScopeQuota {
  return { used, included, remaining: Math.max(0, included - used), atCapacity: used >= included };
}

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiRead);

    const { rows: userRows } = await db.query<{ plan: string; level_creator: number }>(
      `SELECT plan, level_creator FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    const user = userRows[0] ?? { plan: "free", level_creator: 0 };

    const { rows: bizRows } = await db.query<{ id: string; business_name: string; tier: string; status: string }>(
      `SELECT id, business_name, tier, status FROM business_accounts WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    const business = bizRows[0] ?? null;

    const [personalIncluded, personalUsed, personalCost] = await Promise.all([
      getIncludedPersonalBlogCount(user.plan, user.level_creator),
      countActiveBlogsForScope({ ownerId: userId, businessAccountId: null }),
      getExtraBlogSlotCost("personal"),
    ]);

    let businessData:
      | (ScopeQuota & { id: string; name: string; tier: string; status: string; extraSlotCost: BlogExtraSlotCost })
      | null = null;
    if (business) {
      const [businessIncluded, businessUsed, businessCost] = await Promise.all([
        getIncludedBusinessBlogCount(business.tier),
        countActiveBlogsForScope({ ownerId: userId, businessAccountId: business.id }),
        getExtraBlogSlotCost("business"),
      ]);
      businessData = {
        id: business.id,
        name: business.business_name,
        tier: business.tier,
        status: business.status,
        extraSlotCost: businessCost,
        ...toScope(businessUsed, businessIncluded),
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        personal: { plan: user.plan, extraSlotCost: personalCost, ...toScope(personalUsed, personalIncluded) },
        business: businessData,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
