export const dynamic = 'force-dynamic';

/**
 * app/api/admin/payouts/dlq/route.ts
 *
 * GET  /api/admin/payouts/dlq  — list payout dead-letter queue items
 *
 * Returns unresolved DLQ entries with the originating payout and creator details
 * so admins can decide whether to retry or manually resolve each item.
 *
 * Query params:
 *   resolved — "true" to include already-resolved items (default: false)
 *   limit    — max records (default 50, max 200)
 *   offset   — pagination offset (default 0)
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";

interface DlqRow {
  id: string;
  payout_id: string;
  creator_id: string;
  creator_username: string;
  creator_email: string | null;
  failure_reason: string | null;
  retry_count: number;
  last_attempted_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  // From creator_payouts
  payout_gross_kobo: number;
  payout_net_kobo: number;
  payout_method: string;
  payout_region: string;
  payout_status: string;
}

export const GET = withAdminAuth(async (req: NextRequest, _ctx) => {
  try {
    const url = new URL(req.url);
    const includeResolved = url.searchParams.get("resolved") === "true";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10), 0);

    const whereClause = includeResolved ? "" : "WHERE d.resolved_at IS NULL";

    const { rows } = await db.query<DlqRow>(
      `SELECT
         d.id,
         d.payout_id,
         d.creator_id,
         u.username   AS creator_username,
         u.email      AS creator_email,
         d.failure_reason,
         d.retry_count,
         d.last_attempted_at,
         d.resolved_at,
         d.resolution_note,
         d.created_at,
         cp.gross_kobo   AS payout_gross_kobo,
         cp.net_kobo     AS payout_net_kobo,
         cp.payout_method,
         cp.region       AS payout_region,
         cp.status       AS payout_status
       FROM payout_dead_letter_queue d
       JOIN creator_payouts cp ON cp.id = d.payout_id
       JOIN users u ON u.id = d.creator_id
       ${whereClause}
       ORDER BY d.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const { rows: countRows } = await db.query<{ total: string }>(
      `SELECT COUNT(*)::TEXT AS total
       FROM payout_dead_letter_queue d
       ${whereClause}`
    );

    return NextResponse.json({
      items: rows.map((d) => ({
        id: d.id,
        payoutId: d.payout_id,
        creator: {
          id: d.creator_id,
          username: d.creator_username,
          email: d.creator_email,
        },
        failureReason: d.failure_reason,
        retryCount: d.retry_count,
        lastAttemptedAt: d.last_attempted_at,
        resolvedAt: d.resolved_at,
        resolutionNote: d.resolution_note,
        createdAt: d.created_at,
        payout: {
          grossKobo: d.payout_gross_kobo,
          netKobo: d.payout_net_kobo,
          method: d.payout_method,
          region: d.payout_region,
          status: d.payout_status,
        },
      })),
      total: parseInt(countRows[0]?.total ?? "0", 10),
    });
  } catch (err) {
    return handleApiError(err);
  }
});
