export const dynamic = 'force-dynamic';

/**
 * PATCH /api/merch/orders/[orderId]/ship
 *
 * Seller marks an order as shipped/in-transit.
 *
 * Body: { useStepTracking: boolean, note?: string }
 *   - useStepTracking: false → status = 'in_transit', shipped_at = NOW()
 *   - useStepTracking: true  → status = 'shipped', shipped_at = NOW(),
 *                               adds first tracking entry to tracking_updates
 *
 * Only the seller (creator_id) may call this. Order must be 'pending'.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, conflict } from "@/lib/api/errors";
import { sendPushNotification } from "@/lib/notifications/push";

const shipSchema = z.object({
  useStepTracking: z.boolean(),
  note: z.string().max(500).optional(),
});

export const PATCH = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: Promise<{ orderId: string }>; auth: { user: { sub: string } } }
  ) => {
    try {
      const { orderId } = await params;
      const userId = auth.user.sub;
      const body = await validateBody(req, shipSchema);
      const orm = await getDb();

      const orderRows = await orm
        .select({
          id: schema.merchOrders.id,
          creatorId: schema.merchOrders.creatorId,
          buyerId: schema.merchOrders.buyerId,
          status: schema.merchOrders.status,
          productId: schema.merchOrders.productId,
        })
        .from(schema.merchOrders)
        .where(eq(schema.merchOrders.id, orderId))
        .limit(1);
      const order = orderRows[0];
      if (!order) throw notFound("Order not found");
      if (order.creatorId !== userId) throw forbidden("Only the seller can update this order");
      if (order.status !== "pending") throw conflict(`Order is already in status '${order.status}'`);

      const newStatus = body.useStepTracking ? "shipped" : "in_transit";
      const trackingEntry = body.useStepTracking
        ? [{ status: "shipped", note: body.note ?? "Order shipped", timestamp: new Date().toISOString() }]
        : [];

      await orm
        .update(schema.merchOrders)
        .set({
          status: newStatus,
          shippedAt: sql`NOW()`,
          trackingUpdates: trackingEntry,
          updatedAt: sql`NOW()`,
        })
        .where(eq(schema.merchOrders.id, orderId));

      // Notify buyer
      void (async () => {
        try {
          await orm.insert(schema.notifications).values({
            userId: order.buyerId,
            type: "order_shipped",
            title: "Your order is on the way!",
            body: "Your order has been shipped and is on its way to you.",
            metadata: { orderId },
            isRead: false,
          });
          await sendPushNotification(
            order.buyerId,
            "Your order is on the way!",
            "Your order has been shipped.",
            { action: `/merch/order/${orderId}`, priority: "high" }
          );
        } catch { /* non-fatal */ }
      })();

      return NextResponse.json({
        success: true,
        data: { orderId, status: newStatus },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
