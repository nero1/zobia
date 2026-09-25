export const dynamic = "force-dynamic";

/**
 * GET /api/admin/kyc
 *
 * Review queue for identity KYC submissions. Admin or moderator (KYC review
 * is a day-to-day moderation task, same override as /api/admin/forum/**).
 *
 * Query params: status, tier, accountType, userId, cursor (submitted_at ISO), limit
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
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
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") ?? undefined;
    const tier = sp.get("tier") ? Number(sp.get("tier")) : undefined;
    const accountType = sp.get("accountType") ?? undefined;
    const userId = sp.get("userId") ?? undefined;
    const cursor = sp.get("cursor") ?? undefined;
    const limit = Math.min(Number(sp.get("limit") ?? 30), 100);

    const conditions: ReturnType<typeof sql>[] = [];

    if (status) { conditions.push(sql`k.status = ${status}`); }
    // Deep-linking into a specific user's submissions (e.g. from /gate44/users)
    // should show their full history, not just the in-progress queue.
    else if (!userId) { conditions.push(sql`k.status IN ('pending', 'ai_review', 'manual_review')`); }
    if (tier) { conditions.push(sql`k.tier = ${tier}`); }
    if (accountType) { conditions.push(sql`k.account_type = ${accountType}`); }
    if (userId) { conditions.push(sql`k.user_id = ${userId}`); }
    if (cursor) { conditions.push(sql`k.submitted_at < ${cursor}`); }

    const whereClause = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    const orm = await getDb();

    const { rows } = await orm.execute<QueueRow & Record<string, unknown>>(sql`
      SELECT k.id, k.user_id, u.username, u.display_name, k.tier, k.status, k.account_type,
             k.citizenship_country, k.review_mode, k.ai_name_match_score, k.ai_document_confidence,
             k.ai_escalated, k.submitted_at
      FROM kyc_submissions k
      JOIN users u ON u.id = k.user_id
      ${whereClause}
      ORDER BY k.submitted_at DESC
      LIMIT ${limit + 1}
    `);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].submitted_at : null;

    const { rows: counts } = await orm.execute<{ status: string; count: string } & Record<string, unknown>>(sql`
      SELECT status, COUNT(*)::text AS count FROM kyc_submissions
      WHERE status IN ('pending', 'ai_review', 'manual_review') GROUP BY status
    `);

    return NextResponse.json({
      success: true,
      data: { submissions: page, nextCursor, hasMore, queueDepth: counts },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
