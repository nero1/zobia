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
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";
import { recordBusinessPageView } from "@/lib/business/repo";

export const POST = withAuth<{ pageId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { pageId } = await params;
    const { rows } = await db.query<{ id: string }>(
      `SELECT bp.id FROM business_pages bp JOIN business_accounts ba ON ba.id = bp.business_account_id
       WHERE bp.id = $1 AND bp.deleted_at IS NULL AND bp.status = 'active' AND ba.status = 'active' LIMIT 1`,
      [pageId]
    );
    if (!rows[0]) throw notFound("Business page not found");
    await recordBusinessPageView(pageId);
    return NextResponse.json({ success: true, data: { recorded: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
