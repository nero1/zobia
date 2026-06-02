/**
 * GET /api/admin/payouts
 *
 * Admin-only: returns pending payout approvals.
 * Sorted by amount descending (highest value first for prioritization).
 *
 * @module app/api/admin/payouts
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface AdminPayoutRow {
  id: string;
  creator_id: string;
  creator_username: string;
  creator_email: string | null;
  gross_kobo: number;
  net_kobo: number;
  platform_fee_kobo: number;
  status: string;
  bank_account_last4: string | null;
  idempotency_key: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/payouts
 *
 * Query params:
 *   - status: filter by status (default: "awaiting_approval")
 *   - limit:  max records to return (default: 50)
 *   - offset: pagination offset (default: 0)
 */
export const GET = withAdminAuth(async (req: NextRequest, _ctx) => {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "awaiting_approval";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10), 0);

    const { rows } = await db.query<AdminPayoutRow>(
      `SELECT cp.id, cp.creator_id, u.username AS creator_username,
              u.email AS creator_email,
              cp.gross_kobo, cp.net_kobo, cp.platform_fee_kobo,
              cp.status, cp.bank_account_last4, cp.idempotency_key,
              cp.created_at
       FROM creator_payouts cp
       JOIN users u ON u.id = cp.creator_id
       WHERE cp.status = $1
       ORDER BY cp.gross_kobo DESC, cp.created_at ASC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    const { rows: countRows } = await db.query<{ total: string }>(
      `SELECT COUNT(*)::TEXT AS total FROM creator_payouts WHERE status = $1`,
      [status]
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
        bankAccountLast4: p.bank_account_last4,
        createdAt: p.created_at,
      })),
      total: parseInt(countRows[0]?.total ?? "0", 10),
      limit,
      offset,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
