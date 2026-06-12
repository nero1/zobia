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
import { db } from "@/lib/db";
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

      const { rows: orderRows } = await db.query<{
        id: string;
        creator_id: string;
        buyer_id: string;
        status: string;
      }>(
        `SELECT id, creator_id, buyer_id, status
         FROM merch_orders WHERE id = $1 LIMIT 1`,
        [orderId]
      );
      const order = orderRows[0];
      if (!order) throw notFound("Order not found");
      if (order.creator_id !== userId) throw forbidden("Only the seller can update this order");
      if (!["shipped", "in_transit"].includes(order.status)) {
        throw conflict(`Cannot mark as delivered from status '${order.status}'`);
      }

      await db.query(
        `UPDATE merch_orders
         SET status = 'delivered', delivered_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [orderId]
      );

      // Notify buyer to confirm receipt
      void (async () => {
        try {
          await db.query(
            `INSERT INTO notifications (user_id, type, title, body, metadata, created_at)
             VALUES ($1, 'order_delivered', 'Your order has been delivered!',
                     'Your order has arrived. Please confirm receipt in the app.', $2, NOW())`,
            [order.buyer_id, JSON.stringify({ orderId })]
          );
          await sendPushNotification(
            order.buyer_id,
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
