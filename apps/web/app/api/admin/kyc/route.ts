export const dynamic = "force-dynamic";

/**
 * GET /api/admin/kyc
 *
 * Review queue for identity KYC submissions. Admin or moderator (KYC review
 * is a day-to-day moderation task, same override as /api/admin/forum/**).
 *
 * Query params: status, tier, accountType, cursor (submitted_at ISO), limit
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface QueueRow {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  tier: number;
  status: string;
  account_type: string;
  citizenship_country: string | null;
  review_mode: string;
  ai_name_match_score: string | null;
  ai_document_confidence: string | null;
  ai_escalated: boolean;
  submitted_at: string;
}

export const GET = withModeratorOrAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") ?? undefined;
    const tier = sp.get("tier") ? Number(sp.get("tier")) : undefined;
    const accountType = sp.get("accountType") ?? undefined;
    const cursor = sp.get("cursor") ?? undefined;
    const limit = Math.min(Number(sp.get("limit") ?? 30), 100);

    const where: string[] = [];
    const params: (string | number)[] = [];

    if (status) { params.push(status); where.push(`k.status = $${params.length}`); }
    else { where.push(`k.status IN ('pending', 'ai_review', 'manual_review')`); }
    if (tier) { params.push(tier); where.push(`k.tier = $${params.length}`); }
    if (accountType) { params.push(accountType); where.push(`k.account_type = $${params.length}`); }
    if (cursor) { params.push(cursor); where.push(`k.submitted_at < $${params.length}`); }

    params.push(limit + 1);
    const { rows } = await db.query<QueueRow>(
      `SELECT k.id, k.user_id, u.username, u.display_name, k.tier, k.status, k.account_type,
              k.citizenship_country, k.review_mode, k.ai_name_match_score, k.ai_document_confidence,
              k.ai_escalated, k.submitted_at
       FROM kyc_submissions k
       JOIN users u ON u.id = k.user_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY k.submitted_at DESC
       LIMIT $${params.length}`,
      params
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].submitted_at : null;

    const { rows: counts } = await db.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text AS count FROM kyc_submissions
       WHERE status IN ('pending', 'ai_review', 'manual_review') GROUP BY status`
    );

    return NextResponse.json({
      success: true,
      data: { submissions: page, nextCursor, hasMore, queueDepth: counts },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
