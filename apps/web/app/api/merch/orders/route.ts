export const dynamic = 'force-dynamic';

/**
 * GET /api/merch/orders
 *
 * Returns all orders for the authenticated buyer, ordered by most recent.
 * Includes full tracking_updates array, fulfillment_method, and timestamps.
 */

import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface OrderRow {
  id: string;
  product_id: string;
  product_name: string;
  creator_id: string;
  creator_username: string;
  amount_kobo: number;
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
        creator_id: schema.merchOrders.creatorId,
        creator_username: schema.users.username,
        amount_kobo: schema.merchOrders.amountKobo,
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
      .innerJoin(schema.users, eq(schema.users.id, schema.merchOrders.creatorId))
      .where(eq(schema.merchOrders.buyerId, userId))
      .orderBy(desc(schema.merchOrders.createdAt));

    const orders: OrderRow[] = dbRows.map((row) => ({
      ...row,
      creator_id: row.creator_id as string,
      amount_kobo: Number(row.amount_kobo ?? 0),
      shipped_at: row.shipped_at ? row.shipped_at.toISOString() : null,
      delivered_at: row.delivered_at ? row.delivered_at.toISOString() : null,
      confirmed_at: row.confirmed_at ? row.confirmed_at.toISOString() : null,
      created_at: row.created_at ? row.created_at.toISOString() : new Date().toISOString(),
    }));

    return NextResponse.json({
      success: true,
      data: { orders },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
