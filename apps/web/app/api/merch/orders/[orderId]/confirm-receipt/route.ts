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
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, conflict } from "@/lib/api/errors";
import {settleMerchEarnings} from "@/lib/merch/purchase";
import {insertNotification} from "@/lib/notifications/insert";
import { getManifestValue } from "@/lib/manifest";
import { awardMerchPhysicalReferralCommission } from "@/lib/referrals/commissions";

export const PATCH = withAuth(
  async (
    _req: NextRequest,
    { params, auth }: { params: Promise<{ orderId: string }>; auth: { user: { sub: string } } }
  ) => {
    try {
      const { orderId } = await params;
      const userId = auth.user.sub;
      const orm = await getDb();

      await orm.transaction(async (tx) => {
        const orderRows = await tx.select().from(schema.merchOrders).where(eq(schema.merchOrders.id,orderId)).for("update");
        const order = orderRows[0];
        if (!order) throw notFound("Order not found");
        if (order.buyerId !== userId) throw forbidden("Only the buyer can confirm receipt");
        if(order.status==="completed")return;
        if (order.status !== "delivered") {
          throw conflict(`Cannot confirm receipt of an order in status '${order.status}'`);
        }

        // Complete the order
        await tx
          .update(schema.merchOrders)
          .set({ status: "completed", confirmedAt: sql`NOW()`, updatedAt: sql`NOW()` })
          .where(eq(schema.merchOrders.id, orderId));

        const amountKobo = order.amountKobo ?? BigInt(0);
        const platformFeeKobo = order.platformFeeKobo ?? BigInt(0);
        const creatorShareKobo = order.creatorShareKobo ?? BigInt(0);
        const creatorId = order.creatorId;
        if (!creatorId) throw notFound("Order has no associated creator");

        await settleMerchEarnings(tx,order);

        // Physical-item referral commission — deferred to this point (not
        // purchase time) since a physical order can still be refunded or
        // disputed before delivery is confirmed.
        const productRows = await tx
          .select({
            referralEnabled: schema.merchProducts.referralEnabled,
            referralCommissionPct: schema.merchProducts.referralCommissionPct,
          })
          .from(schema.merchProducts)
          .where(eq(schema.merchProducts.id, order.productId))
          .limit(1);
        const product = productRows[0];
        if (amountKobo>0n && product?.referralEnabled && product.referralCommissionPct) {
          const physicalReferralsEnabled = await getManifestValue("market_referral_physical_enabled", tx as never);
          if (physicalReferralsEnabled === "true") {
            await awardMerchPhysicalReferralCommission(
              tx as never,
              order.buyerId,
              Number(amountKobo),
              parseFloat(product.referralCommissionPct),
              orderId
            );
          }
        }

        await insertNotification(tx,creatorId,"order_confirmed","Order confirmed by buyer","A buyer confirmed receipt. Earnings have been credited.",{orderId},orderId);

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
