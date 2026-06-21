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
 *   cursor        — opaque keyset cursor from previous page (base64 JSON {grossKobo, createdAt, id})
 *
 * BUG-20 FIX: OFFSET pagination is replaced with keyset (cursor) pagination to
 * avoid O(N) full-table scans on large payout tables.
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
    const cursorParam = url.searchParams.get("cursor");
    let cursor: { grossKobo: number; createdAt: string; id: string } | null = null;
    if (cursorParam) {
      try {
        cursor = JSON.parse(Buffer.from(cursorParam, "base64url").toString("utf8"));
      } catch {
        // Ignore malformed cursor — start from beginning
      }
    }

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

    // Keyset cursor condition — sort is (gross_kobo DESC, created_at ASC, id ASC)
    if (cursor) {
      conditions.push(
        `(cp.gross_kobo < $${paramIndex} OR (cp.gross_kobo = $${paramIndex} AND (cp.created_at > $${paramIndex + 1} OR (cp.created_at = $${paramIndex + 1} AND cp.id > $${paramIndex + 2}))))`
      );
      params.push(cursor.grossKobo, cursor.createdAt, cursor.id);
      paramIndex += 3;
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
       ORDER BY cp.gross_kobo DESC, cp.created_at ASC, cp.id ASC
       LIMIT $${paramIndex++}`,
      [...params, limit]
    );

    const lastRow = rows[rows.length - 1];
    const nextCursor =
      rows.length === limit && lastRow
        ? Buffer.from(
            JSON.stringify({ grossKobo: lastRow.gross_kobo, createdAt: lastRow.created_at, id: lastRow.id }),
            "utf8"
          ).toString("base64url")
        : null;

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
      limit,
      nextCursor,
      hasMore: nextCursor !== null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
