export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/payouts
 *
 * Admin: list creator payouts with rich filtering.
 *
 * Query params:
 *   status        — filter by status (default: "awaiting_approval"); use "all" for no filter
 *   method        — filter by payout_method (bank_transfer|coins|crypto)
 *   region        — filter by region (nigeria|global)
 *   appealPending — "true" to show only payouts with pending appeals
 *   limit         — max records (default 50, max 200)
 *   offset        — pagination offset (default 0)
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";

interface AdminPayoutRow {
  id: string;
  creator_id: string;
  creator_username: string;
  creator_email: string | null;
  gross_kobo: number;
  net_kobo: number;
  platform_fee_kobo: number;
  status: string;
  payout_method: string;
  region: string;
  bank_account_snapshot: Record<string, string> | null;
  wallet_address_snapshot: string | null;
  idempotency_key: string;
  retry_count: number;
  rejection_reason: string | null;
  appeal_status: string | null;
  appeal_reason: string | null;
  created_at: string;
  approved_at: string | null;
}

export const GET = withAdminAuth(async (req: NextRequest, _ctx) => {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "awaiting_approval";
    const method = url.searchParams.get("method");
    const region = url.searchParams.get("region");
    const appealPending = url.searchParams.get("appealPending") === "true";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10), 0);

    // Build dynamic WHERE clauses
    const conditions: string[] = [];
    const params: (string | number | boolean)[] = [];
    let paramIndex = 1;

    if (status !== "all") {
      conditions.push(`cp.status = $${paramIndex++}`);
      params.push(status);
    }
    if (method) {
      conditions.push(`cp.payout_method = $${paramIndex++}`);
      params.push(method);
    }
    if (region) {
      conditions.push(`cp.region = $${paramIndex++}`);
      params.push(region);
    }
    if (appealPending) {
      conditions.push(`cp.appeal_status = 'pending'`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await db.query<AdminPayoutRow>(
      `SELECT cp.id, cp.creator_id,
              u.username AS creator_username, u.email AS creator_email,
              cp.gross_kobo, cp.net_kobo, cp.platform_fee_kobo,
              cp.status, cp.payout_method, cp.region,
              cp.bank_account_snapshot, cp.wallet_address_snapshot,
              cp.idempotency_key, cp.retry_count,
              cp.rejection_reason, cp.appeal_status, cp.appeal_reason,
              cp.created_at, cp.approved_at
       FROM creator_payouts cp
       JOIN users u ON u.id = cp.creator_id
       ${where}
       ORDER BY cp.gross_kobo DESC, cp.created_at ASC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset]
    );

    const countParams = [...params];
    const { rows: countRows } = await db.query<{ total: string }>(
      `SELECT COUNT(*)::TEXT AS total
       FROM creator_payouts cp
       JOIN users u ON u.id = cp.creator_id
       ${where}`,
      countParams
    );

    return NextResponse.json({
      payouts: rows.map((p) => ({
        id: p.id,
        creator: {
          id: p.creator_id,
          username: p.creator_username,
          email: p.creator_email,
        },
        grossKobo: p.gross_kobo,
        netKobo: p.net_kobo,
        platformFeeKobo: p.platform_fee_kobo,
        status: p.status,
        method: p.payout_method,
        region: p.region,
        bankAccountSnapshot: p.bank_account_snapshot,
        hasWalletSnapshot: !!p.wallet_address_snapshot,
        retryCount: p.retry_count,
        rejectionReason: p.rejection_reason,
        appealStatus: p.appeal_status,
        appealReason: p.appeal_reason,
        createdAt: p.created_at,
        approvedAt: p.approved_at,
      })),
      total: parseInt(countRows[0]?.total ?? "0", 10),
      limit,
      offset,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
