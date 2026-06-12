export const dynamic = 'force-dynamic';

/**
 * PATCH /api/merch/orders/[orderId]/tracking
 *
 * Seller appends a tracking update to an order that is in 'shipped' status.
 * Body: { note: string }
 *
 * Only the seller (creator_id) may call this. Order must be 'shipped'.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, conflict } from "@/lib/api/errors";
import { sendPushNotification } from "@/lib/notifications/push";

const trackingSchema = z.object({
  note: z.string().min(1).max(500),
});

export const PATCH = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: Promise<{ orderId: string }>; auth: { user: { sub: string } } }
  ) => {
    try {
      const { orderId } = await params;
      const userId = auth.user.sub;
      const body = await validateBody(req, trackingSchema);

      const { rows: orderRows } = await db.query<{
        id: string;
        creator_id: string;
        buyer_id: string;
        status: string;
        tracking_updates: unknown;
      }>(
        `SELECT id, creator_id, buyer_id, status, tracking_updates
         FROM merch_orders WHERE id = $1 LIMIT 1`,
        [orderId]
      );
      const order = orderRows[0];
      if (!order) throw notFound("Order not found");
      if (order.creator_id !== userId) throw forbidden("Only the seller can update this order");
      if (order.status !== "shipped") {
        throw conflict("Tracking updates can only be added to orders in 'shipped' status");
      }

      const newEntry = {
        status: "update",
        note: body.note,
        timestamp: new Date().toISOString(),
      };

      await db.query(
        `UPDATE merch_orders
         SET tracking_updates = tracking_updates || $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(newEntry), orderId]
      );

      // Notify buyer
      void (async () => {
        try {
          await db.query(
            `INSERT INTO notifications (user_id, type, title, body, metadata, created_at)
             VALUES ($1, 'order_tracking_update', 'Order update', $2, $3, NOW())`,
            [order.buyer_id, body.note, JSON.stringify({ orderId })]
          );
          await sendPushNotification(
            order.buyer_id,
            "Order update",
            body.note,
            { action: `/merch/order/${orderId}`, priority: "normal" }
          );
        } catch { /* non-fatal */ }
      })();

      return NextResponse.json({
        success: true,
        data: { orderId, note: body.note },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
