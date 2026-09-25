export const dynamic = 'force-dynamic';

/**
 * GET /api/merch/seller/orders
 *
 * Returns all orders for the authenticated seller (creator), grouped by status.
 * Ordered: pending → shipped → in_transit → delivered → completed → refunded.
 */

import { NextRequest, NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

    const orm = await getDb();
    const dbRows = await orm
      .select({
        id: schema.merchOrders.id,
        product_id: schema.merchOrders.productId,
        product_name: schema.merchProducts.name,
        buyer_id: schema.merchOrders.buyerId,
        buyer_username: schema.users.username,
        amount_kobo: schema.merchOrders.amountKobo,
        creator_share_kobo: schema.merchOrders.creatorShareKobo,
        status: schema.merchOrders.status,
        fulfillment_method: schema.merchOrders.fulfillmentMethod,
        seller_notes: schema.merchOrders.sellerNotes,
        shipped_at: schema.merchOrders.shippedAt,
        delivered_at: schema.merchOrders.deliveredAt,
        confirmed_at: schema.merchOrders.confirmedAt,
        tracking_updates: schema.merchOrders.trackingUpdates,
        shipping_name: schema.merchOrders.shippingName,
        shipping_address: schema.merchOrders.shippingAddress,
        shipping_city: schema.merchOrders.shippingCity,
        shipping_country: schema.merchOrders.shippingCountry,
        created_at: schema.merchOrders.createdAt,
      })
      .from(schema.merchOrders)
      .innerJoin(schema.merchProducts, eq(schema.merchProducts.id, schema.merchOrders.productId))
      .innerJoin(schema.users, eq(schema.users.id, schema.merchOrders.buyerId))
      .where(eq(schema.merchOrders.creatorId, userId))
      .orderBy(
        asc(sql`CASE ${schema.merchOrders.status}
           WHEN 'pending'    THEN 0
           WHEN 'shipped'    THEN 1
           WHEN 'in_transit' THEN 2
           WHEN 'delivered'  THEN 3
           WHEN 'completed'  THEN 4
           WHEN 'refunded'   THEN 5
           ELSE 6
         END`),
        sql`${schema.merchOrders.createdAt} DESC`
      );

    const rows: SellerOrderRow[] = dbRows.map((row) => ({
      ...row,
      buyer_id: row.buyer_id,
      amount_kobo: Number(row.amount_kobo ?? 0),
      creator_share_kobo: Number(row.creator_share_kobo ?? 0),
      shipped_at: row.shipped_at ? row.shipped_at.toISOString() : null,
      delivered_at: row.delivered_at ? row.delivered_at.toISOString() : null,
      confirmed_at: row.confirmed_at ? row.confirmed_at.toISOString() : null,
      created_at: row.created_at ? row.created_at.toISOString() : new Date().toISOString(),
    }));

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
