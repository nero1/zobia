export const dynamic = "force-dynamic";

/**
 * app/api/business/pages/[pageId]/view/route.ts
 *
 * POST — record one view of a public Business Page. Deduped client-side via
 * localStorage (see components/business/PageViewTracker.tsx), so this stays
 * a cheap single UPDATE + daily-stats upsert — mirrors the Blogs post view
 * endpoint exactly.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb, schema } from "@/lib/db/drizzle";
import { recordBusinessPageView } from "@/lib/business/repo";

export const POST = withAuth<{ pageId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { pageId } = await params;
    const orm = await getDb();
    const [row] = await orm
      .select({ id: schema.businessPages.id })
      .from(schema.businessPages)
      .innerJoin(schema.businessAccounts, eq(schema.businessAccounts.id, schema.businessPages.businessAccountId))
      .where(
        and(
          eq(schema.businessPages.id, pageId),
          isNull(schema.businessPages.deletedAt),
          eq(schema.businessPages.status, "active"),
          eq(schema.businessAccounts.status, "active")
        )
      )
      .limit(1);
    if (!row) throw notFound("Business page not found");
    await recordBusinessPageView(pageId);
    return NextResponse.json({ success: true, data: { recorded: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
