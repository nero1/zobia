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
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
      const orm = await getDb();

      const orderRows = await orm
        .select({
          id: schema.merchOrders.id,
          creatorId: schema.merchOrders.creatorId,
          buyerId: schema.merchOrders.buyerId,
          status: schema.merchOrders.status,
          trackingUpdates: schema.merchOrders.trackingUpdates,
        })
        .from(schema.merchOrders)
        .where(eq(schema.merchOrders.id, orderId))
        .limit(1);
      const order = orderRows[0];
      if (!order) throw notFound("Order not found");
      if (order.creatorId !== userId) throw forbidden("Only the seller can update this order");
      if (order.status !== "shipped") {
        throw conflict("Tracking updates can only be added to orders in 'shipped' status");
      }

      const newEntry = {
        status: "update",
        note: body.note,
        timestamp: new Date().toISOString(),
      };

      await orm
        .update(schema.merchOrders)
        .set({
          trackingUpdates: sql`${schema.merchOrders.trackingUpdates} || ${JSON.stringify(newEntry)}::jsonb`,
          updatedAt: sql`NOW()`,
        })
        .where(eq(schema.merchOrders.id, orderId));

      // Notify buyer
      void (async () => {
        try {
          await orm.insert(schema.notifications).values({
            userId: order.buyerId,
            type: "order_tracking_update",
            title: "Order update",
            body: body.note,
            metadata: { orderId },
            isRead: false,
          });
          await sendPushNotification(
            order.buyerId,
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
