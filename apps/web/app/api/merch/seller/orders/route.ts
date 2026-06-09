export const dynamic = 'force-dynamic';

/**
 * GET /api/merch/seller/orders
 *
 * Returns all orders for the authenticated seller (creator), grouped by status.
 * Ordered: pending → shipped → in_transit → delivered → completed → refunded.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface SellerOrderRow {
  id: string;
  product_id: string;
  product_name: string;
  buyer_id: string;
  buyer_username: string;
  amount_kobo: number;
  creator_share_kobo: number;
  status: string;
  fulfillment_method: string | null;
  seller_notes: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  confirmed_at: string | null;
  tracking_updates: unknown;
  shipping_name: string | null;
  shipping_address: string | null;
  shipping_city: string | null;
  shipping_country: string | null;
  created_at: string;
}

const STATUS_ORDER = ['pending', 'shipped', 'in_transit', 'delivered', 'completed', 'refunded'];

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiRead);

    const { rows } = await db.query<SellerOrderRow>(
      `SELECT
         mo.id,
         mo.product_id,
         mp.name AS product_name,
         mo.buyer_id,
         u.username AS buyer_username,
         mo.amount_kobo,
         mo.creator_share_kobo,
         mo.status,
         mo.fulfillment_method,
         mo.seller_notes,
         mo.shipped_at,
         mo.delivered_at,
         mo.confirmed_at,
         mo.tracking_updates,
         mo.shipping_name,
         mo.shipping_address,
         mo.shipping_city,
         mo.shipping_country,
         mo.created_at
       FROM merch_orders mo
       JOIN merch_products mp ON mp.id = mo.product_id
       JOIN users u ON u.id = mo.buyer_id
       WHERE mo.creator_id = $1
       ORDER BY
         CASE mo.status
           WHEN 'pending'    THEN 0
           WHEN 'shipped'    THEN 1
           WHEN 'in_transit' THEN 2
           WHEN 'delivered'  THEN 3
           WHEN 'completed'  THEN 4
           WHEN 'refunded'   THEN 5
           ELSE 6
         END ASC,
         mo.created_at DESC`,
      [userId]
    );

    // Group by status
    const grouped: Record<string, SellerOrderRow[]> = {};
    for (const status of STATUS_ORDER) {
      grouped[status] = [];
    }
    for (const row of rows) {
      (grouped[row.status] ??= []).push(row);
    }

    return NextResponse.json({
      success: true,
      data: { orders: rows, grouped },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
