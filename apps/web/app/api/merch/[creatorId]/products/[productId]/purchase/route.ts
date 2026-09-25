export const dynamic = 'force-dynamic';

/**
 * app/api/merch/[creatorId]/products/[productId]/purchase/route.ts
 *
 * POST /api/merch/:creatorId/products/:productId/purchase
 *   Purchase a merch product.
 *   - Deducts coins from buyer (convert kobo to coins: price_kobo / 100)
 *   - Creates a merch_order record
 *   - Credits 80% to creator via creator_earnings
 *   - Awards XP to buyer
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, conflict, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled, getManifestValue } from "@/lib/manifest";
import { sendPushNotification } from "@/lib/notifications/push";
import { sendEmail } from "@/lib/notifications/email";
import { awardMerchDigitalReferralCommission } from "@/lib/referrals/commissions";
import { triggerActivityQuestProgress } from "@/lib/quests/questEngine";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CREATOR_SHARE_PCT = 80;
const PLATFORM_FEE_PCT = 20;
const XP_AWARD_MERCH_PURCHASE = 50;

const purchaseSchema = z.object({
  shippingName:      z.string().max(200).optional(),
  shippingAddress:   z.string().max(500).optional(),
  shippingCity:      z.string().max(100).optional(),
  shippingCountry:   z.string().max(100).optional(),
  fulfillmentMethod: z.enum(["manual", "partner"]).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/merch/:creatorId/products/:productId/purchase
// ---------------------------------------------------------------------------

export const POST = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: {
      params: { creatorId: string; productId: string };
      auth: { user: { sub: string } };
    }
  ) => {
    try {
      const { creatorId, productId } = await params;
      const userId = auth.user.sub;
      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);
      await requireFeatureEnabled("merchStore");

      // Cannot buy your own product
      if (userId === creatorId) {
        throw forbidden("You cannot purchase your own merch");
      }

      const body = await validateBody(req, purchaseSchema);
      const orm = await getDb();

      // Reject partner fulfillment (Coming Soon)
      if (body.fulfillmentMethod === "partner") {
        throw badRequest(
          "Partner fulfillment integration is coming soon. Please use manual fulfillment.",
          "PARTNER_FULFILLMENT_COMING_SOON"
        );
      }

      // Fetch creator tier and store settings for revenue share + fulfillment
      const creatorRows = await orm
        .select({
          creatorTier: schema.users.creatorTier,
          storeDefaultFulfillment: schema.merchStores.defaultFulfillmentMethod,
        })
        .from(schema.users)
        .leftJoin(schema.merchStores, eq(schema.merchStores.creatorId, schema.users.id))
        .where(and(eq(schema.users.id, creatorId), isNull(schema.users.deletedAt)))
        .limit(1);
      const creatorTier = creatorRows[0]?.creatorTier ?? null;
      const storeFulfillment = creatorRows[0]?.storeDefaultFulfillment ?? "manual";

      const result = await orm.transaction(async (tx) => {
        // Fetch product with store verification
        const productRows = await tx
          .select({
            id: schema.merchProducts.id,
            storeId: schema.merchProducts.storeId,
            name: schema.merchProducts.name,
            priceKobo: schema.merchProducts.priceKobo,
            isActive: schema.merchProducts.isActive,
            stock: schema.merchProducts.stock,
            productType: schema.merchProducts.productType,
            referralEnabled: schema.merchProducts.referralEnabled,
          })
          .from(schema.merchProducts)
          .innerJoin(schema.merchStores, eq(schema.merchStores.id, schema.merchProducts.storeId))
          .where(and(eq(schema.merchProducts.id, productId), eq(schema.merchStores.creatorId, creatorId)))
          .for("update");
        if (!productRows[0]) throw notFound("Product not found");
        const product = productRows[0];
        if (!product.isActive) throw notFound("Product is no longer available");

        // Check stock
        if (product.stock !== null && product.stock <= 0) {
          throw conflict("Product is out of stock");
        }

        // Physical products require shipping details
        if (product.productType === "physical") {
          if (!body.shippingName || !body.shippingAddress || !body.shippingCity || !body.shippingCountry) {
            throw badRequest("Shipping name, address, city, and country are required for physical products");
          }
        }

        // Convert price: kobo / 100 = coins
        const priceKobo = Number(product.priceKobo);
        const priceCoins = Math.ceil(priceKobo / 100);

        // Check duplicate purchase for digital products
        if (product.productType === "digital") {
          const existingOrder = await tx
            .select({ id: schema.merchOrders.id })
            .from(schema.merchOrders)
            .where(
              and(
                eq(schema.merchOrders.productId, productId),
                eq(schema.merchOrders.buyerId, userId),
                ne(schema.merchOrders.status, "refunded")
              )
            )
            .limit(1);
          if (existingOrder.length > 0) {
            throw conflict("You already own this digital product");
          }
        }

        // Fetch and lock buyer's coin balance
        const userRows = await tx
          .select({ coinBalance: schema.users.coinBalance })
          .from(schema.users)
          .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
          .for("update");
        if (!userRows[0]) throw notFound("User not found");
        const coinBalance = Number(userRows[0].coinBalance);

        if (coinBalance < priceCoins) {
          throw forbidden(`Insufficient coins. This item costs ${priceCoins} coins.`);
        }

        // Deduct coins from buyer
        const newBalance = coinBalance - priceCoins;
        await tx
          .update(schema.users)
          .set({ coinBalance: BigInt(newBalance), updatedAt: sql`NOW()` })
          .where(eq(schema.users.id, userId));

        // Log coin transaction
        await tx.insert(schema.coinLedger).values({
          userId,
          amount: BigInt(-priceCoins),
          balanceBefore: BigInt(coinBalance),
          balanceAfter: BigInt(newBalance),
          transactionType: "merch_purchase",
          description: `Purchased merch: ${product.name}`,
        });

        // Calculate creator share and platform fee (85% for Icon, 80% otherwise)
        const effectiveSharePct = creatorTier === 'icon' ? 85 : CREATOR_SHARE_PCT;
        const creatorShareKobo = Math.floor((priceKobo * effectiveSharePct) / 100);
        const platformFeeKobo = priceKobo - creatorShareKobo;

        // Physical products: pending until delivered + confirmed
        // Digital products: completed immediately
        const isPhysical = product.productType === "physical";
        const orderStatus = isPhysical ? "pending" : "completed";
        const fulfillmentMethod = isPhysical ? (body.fulfillmentMethod ?? storeFulfillment) : null;

        // Create merch order (with optional shipping details for physical products)
        const orderRows = await tx
          .insert(schema.merchOrders)
          .values({
            productId,
            buyerId: userId,
            creatorId,
            amountKobo: BigInt(priceKobo),
            creatorShareKobo: BigInt(creatorShareKobo),
            platformFeeKobo: BigInt(platformFeeKobo),
            status: orderStatus,
            fulfillmentMethod,
            shippingName: body.shippingName ?? null,
            shippingAddress: body.shippingAddress ?? null,
            shippingCity: body.shippingCity ?? null,
            shippingCountry: body.shippingCountry ?? null,
          })
          .returning({ id: schema.merchOrders.id });
        const orderId = orderRows[0].id;

        // Credit creator earnings immediately for digital; defer to confirm-receipt for physical
        if (!isPhysical) {
          await tx.insert(schema.creatorEarnings).values({
            creatorId,
            sourceType: "merch",
            grossAmountKobo: BigInt(priceKobo),
            platformFeeKobo: BigInt(platformFeeKobo),
            netAmountKobo: BigInt(creatorShareKobo),
            referenceId: orderId,
          });
          await tx
            .update(schema.users)
            .set({
              availableEarningsKobo: sql`COALESCE(${schema.users.availableEarningsKobo}, 0) + ${creatorShareKobo}`,
              updatedAt: sql`NOW()`,
            })
            .where(eq(schema.users.id, creatorId));
        }

        // Decrement stock if limited
        if (product.stock !== null) {
          await tx
            .update(schema.merchProducts)
            .set({ stock: sql`${schema.merchProducts.stock} - 1` })
            .where(eq(schema.merchProducts.id, productId));
        }

        // Digital-item referral commission (standard tier1/tier2 rates).
        // Physical items are deferred to confirm-receipt since the order can
        // still be refunded/disputed before then.
        if (!isPhysical && product.referralEnabled) {
          const digitalReferralsEnabled = await getManifestValue("market_referral_digital_enabled", tx as never);
          if (digitalReferralsEnabled === "true") {
            await awardMerchDigitalReferralCommission(tx as never, userId, priceKobo, orderId).catch((err) => {
              logger.error({ err, orderId }, "[merch] Digital referral commission failed (non-fatal)");
            });
          }
        }

        // Award XP to buyer
        await tx
          .update(schema.users)
          .set({
            xpTotal: sql`${schema.users.xpTotal} + ${XP_AWARD_MERCH_PURCHASE}`,
            xpSocial: sql`${schema.users.xpSocial} + ${XP_AWARD_MERCH_PURCHASE}`,
            updatedAt: sql`NOW()`,
          })
          .where(eq(schema.users.id, userId));

        await tx.insert(schema.xpLedger).values({
          userId,
          amount: XP_AWARD_MERCH_PURCHASE,
          track: "social",
          source: "merch_purchase",
          baseAmount: XP_AWARD_MERCH_PURCHASE,
          referenceId: orderId,
        });

        return {
          orderId,
          productId,
          productName: product.name,
          productType: product.productType,
          orderStatus,
          fulfillmentMethod,
          priceCoins,
          priceKobo,
          creatorShareKobo: isPhysical ? 0 : creatorShareKobo,
          platformFeeKobo: isPhysical ? 0 : platformFeeKobo,
          newCoinBalance: newBalance,
          xpAwarded: XP_AWARD_MERCH_PURCHASE,
        };
      });

      void triggerActivityQuestProgress(userId, "market_purchase", orm);

      // Notify seller — in-app, push, and email (fire-and-forget, non-blocking)
      const shippingDesc = result.productType === 'physical' && body.shippingCity
        ? ` — shipping to ${body.shippingCity}, ${body.shippingCountry}`
        : '';
      void (async () => {
        try {
          // 1. In-app notification
          await orm.insert(schema.notifications).values({
            userId: creatorId,
            type: "new_merch_order",
            title: `New order: ${result.productName}`,
            body: `You have a new order for "${result.productName}"${shippingDesc}.`,
            metadata: { orderId: result.orderId, productId, buyerId: userId },
            isRead: false,
          });
          // 2. Push notification
          await sendPushNotification(
            creatorId,
            'New Merch Order!',
            `Someone ordered "${result.productName}"${shippingDesc}.`,
            { action: '/creator/orders', priority: 'high' }
          );
          // 3. Email notification
          const creatorEmailRows = await orm
            .select({ email: schema.users.email })
            .from(schema.users)
            .where(and(eq(schema.users.id, creatorId), isNull(schema.users.deletedAt)))
            .limit(1);
          const creatorEmail = creatorEmailRows[0]?.email;
          if (creatorEmail) {
            await sendEmail(
              creatorEmail,
              `New order: ${result.productName}`,
              `You have a new order for "${result.productName}"${shippingDesc}.\n\nOrder ID: ${result.orderId}\nEarnings: ₦${(result.creatorShareKobo / 100).toFixed(2)}\n\nLog in to Zobia to manage your orders.`,
              undefined,
              'transactional'
            );
          }
        } catch {
          // Non-fatal — seller notification failure must not affect buyer experience
        }
      })();

      return NextResponse.json(
        { success: true, data: result, error: null },
        { status: 201 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);
