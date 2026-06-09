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
import { db } from "@/lib/db";
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

      const { rows: orderRows } = await db.query<{
        id: string;
        creator_id: string;
        buyer_id: string;
        status: string;
        product_id: string;
      }>(
        `SELECT id, creator_id, buyer_id, status, product_id
         FROM merch_orders WHERE id = $1 LIMIT 1`,
        [orderId]
      );
      const order = orderRows[0];
      if (!order) throw notFound("Order not found");
      if (order.creator_id !== userId) throw forbidden("Only the seller can update this order");
      if (order.status !== "pending") throw conflict(`Order is already in status '${order.status}'`);

      const newStatus = body.useStepTracking ? "shipped" : "in_transit";
      const trackingEntry = body.useStepTracking
        ? JSON.stringify([{ status: "shipped", note: body.note ?? "Order shipped", timestamp: new Date().toISOString() }])
        : "[]";

      await db.query(
        `UPDATE merch_orders
         SET status = $1, shipped_at = NOW(),
             tracking_updates = $2::jsonb,
             updated_at = NOW()
         WHERE id = $3`,
        [newStatus, trackingEntry, orderId]
      );

      // Notify buyer
      void (async () => {
        try {
          await db.query(
            `INSERT INTO user_notifications (user_id, type, title, body, metadata, created_at)
             VALUES ($1, 'order_shipped', 'Your order is on the way!',
                     'Your order has been shipped and is on its way to you.', $2, NOW())`,
            [order.buyer_id, JSON.stringify({ orderId })]
          );
          await sendPushNotification(
            order.buyer_id,
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
