export const dynamic = "force-dynamic";

/**
 * app/api/classroom/studio/route.ts
 *
 * GET /api/classroom/studio — the classroom creator panel's summary: every
 * classroom the caller created with per-classroom stats, aggregate totals,
 * the stats tier (plan/creator-tier gated) and the caller's withdrawable
 * balance. Withdrawals themselves go through the existing
 * GET/POST /api/creator/payouts flow — classroom revenue lands in the same
 * users.available_earnings_kobo balance, so there is no second ledger.
 */

import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { ok } from "@/lib/classroom/http";
import { resolveClassroomStatsTier } from "@/lib/classroom/limits";
import { getStudioSummary } from "@/lib/classroom/stats";

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    await requireFeatureEnabled("classrooms");
    const orm = await getDb();
    const [me] = await orm
      .select({
        plan: schema.users.plan,
        creator_tier: schema.users.creatorTier,
        is_creator: schema.users.isCreator,
        available_earnings_kobo: schema.users.availableEarningsKobo,
        username: schema.users.username,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, auth.user.sub), isNull(schema.users.deletedAt)))
      .limit(1);
    const tier = resolveClassroomStatsTier(me?.plan, me?.creator_tier);
    const summary = await getStudioSummary(auth.user.sub, tier);
    return ok({
      ...summary,
      username: me?.username ?? null,
      plan: me?.plan ?? "free",
      creatorTier: me?.creator_tier ?? null,
      // Withdrawals require creator status (see /api/creator/payouts).
      canWithdraw: !!me?.is_creator,
      availableEarningsKobo: Number(me?.available_earnings_kobo ?? 0),
    });
  } catch (err) {
    return handleApiError(err);
  }
});
