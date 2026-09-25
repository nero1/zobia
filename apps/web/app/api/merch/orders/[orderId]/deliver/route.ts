export const dynamic = 'force-dynamic';

/**
 * PATCH /api/merch/orders/[orderId]/deliver
 *
 * Seller marks order as delivered.
 * Order must be in 'shipped' or 'in_transit' status.
 * Notifies buyer to confirm receipt.
 *
 * Only the seller (creator_id) may call this.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, conflict } from "@/lib/api/errors";
import { sendPushNotification } from "@/lib/notifications/push";

export const PATCH = withAuth(
  async (
    _req: NextRequest,
    { params, auth }: { params: Promise<{ orderId: string }>; auth: { user: { sub: string } } }
  ) => {
    try {
      const { orderId } = await params;
      const userId = auth.user.sub;
      const orm = await getDb();

      const orderRows = await orm
        .select({
          id: schema.merchOrders.id,
          creatorId: schema.merchOrders.creatorId,
          buyerId: schema.merchOrders.buyerId,
          status: schema.merchOrders.status,
        })
        .from(schema.merchOrders)
        .where(eq(schema.merchOrders.id, orderId))
        .limit(1);
      const order = orderRows[0];
      if (!order) throw notFound("Order not found");
      if (order.creatorId !== userId) throw forbidden("Only the seller can update this order");
      if (!["shipped", "in_transit"].includes(order.status)) {
        throw conflict(`Cannot mark as delivered from status '${order.status}'`);
      }

      await orm
        .update(schema.merchOrders)
        .set({ status: "delivered", deliveredAt: sql`NOW()`, updatedAt: sql`NOW()` })
        .where(eq(schema.merchOrders.id, orderId));

      // Notify buyer to confirm receipt
      void (async () => {
        try {
          await orm.insert(schema.notifications).values({
            userId: order.buyerId,
            type: "order_delivered",
            title: "Your order has been delivered!",
            body: "Your order has arrived. Please confirm receipt in the app.",
            metadata: { orderId },
            isRead: false,
          });
          await sendPushNotification(
            order.buyerId,
            "Your order has arrived!",
            "Please confirm receipt of your order.",
            { action: `/merch/order/${orderId}`, priority: "high" }
          );
        } catch { /* non-fatal */ }
      })();

      return NextResponse.json({
        success: true,
        data: { orderId, status: "delivered" },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
