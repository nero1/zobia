export const dynamic = 'force-dynamic';

/**
 * PATCH /api/merch/orders/[orderId]/confirm-receipt
 *
 * Buyer confirms receipt of a delivered order.
 * - Sets status = 'completed', confirmed_at = NOW()
 * - Credits creator earnings (this is deferred from purchase time for physical orders)
 *
 * Only the buyer (buyer_id) may call this. Order must be 'delivered'.
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

      await db.transaction(async (tx) => {
        const { rows: orderRows } = await tx.query<{
          id: string;
          buyer_id: string;
          creator_id: string;
          status: string;
          amount_kobo: number;
          creator_share_kobo: number;
          platform_fee_kobo: number;
        }>(
          `SELECT id, buyer_id, creator_id, status,
                  amount_kobo, creator_share_kobo, platform_fee_kobo
           FROM merch_orders WHERE id = $1 FOR UPDATE`,
          [orderId]
        );
        const order = orderRows[0];
        if (!order) throw notFound("Order not found");
        if (order.buyer_id !== userId) throw forbidden("Only the buyer can confirm receipt");
        if (order.status !== "delivered") {
          throw conflict(`Cannot confirm receipt of an order in status '${order.status}'`);
        }

        // Complete the order
        await tx.query(
          `UPDATE merch_orders
           SET status = 'completed', confirmed_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [orderId]
        );

        // Credit creator earnings (deferred from purchase for physical orders)
        await tx.query(
          `INSERT INTO creator_earnings
             (creator_id, source_type, gross_amount_kobo, platform_fee_kobo, net_amount_kobo, reference_id, created_at)
           VALUES ($1, 'merch', $2, $3, $4, $5, NOW())`,
          [
            order.creator_id,
            order.amount_kobo,
            order.platform_fee_kobo,
            order.creator_share_kobo,
            orderId,
          ]
        );
        await tx.query(
          `UPDATE users
           SET available_earnings_kobo = COALESCE(available_earnings_kobo, 0) + $1,
               updated_at = NOW()
           WHERE id = $2`,
          [order.creator_share_kobo, order.creator_id]
        );

        // Notify seller of confirmed receipt
        void (async () => {
          try {
            await db.query(
              `INSERT INTO notifications (user_id, type, title, body, metadata, created_at)
               VALUES ($1, 'order_confirmed', 'Order confirmed by buyer',
                       'A buyer has confirmed receipt of their order. Earnings have been credited.', $2, NOW())`,
              [order.creator_id, JSON.stringify({ orderId })]
            );
            await sendPushNotification(
              order.creator_id,
              "Order confirmed!",
              "A buyer confirmed receipt. Your earnings have been credited.",
              { action: `/creator/orders`, priority: "normal" }
            );
          } catch { /* non-fatal */ }
        })();
      });

      return NextResponse.json({
        success: true,
        data: { orderId, status: "completed" },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
