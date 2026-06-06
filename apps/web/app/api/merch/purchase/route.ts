/**
 * app/api/merch/purchase/route.ts
 *
 * POST /api/merch/purchase
 *
 * Purchase a creator merch product. Supports three payment methods:
 *   - coins        → Atomic coin debit + creator credit (in-app currency)
 *   - paystack     → Redirect to Paystack checkout
 *   - dodopayments → Redirect to DodoPayments checkout
 *
 * Coin payment flow (fully atomic):
 *   1. Load and validate the product (active, in stock).
 *   2. Compute platform fee (20%) and creator net.
 *   3. Debit buyer's coins.
 *   4. Insert merch_orders record.
 *   5. Decrement stock (if finite) — rolls back if out of stock.
 *   6. Insert creator_earnings record.
 *   7. Credit creator's coins.
 *
 * External payment flow:
 *   Initialises a payment session via the active provider and returns the
 *   redirect URL. Order fulfilment happens through the provider's webhook.
 *
 * Platform fee: 20% of the product price.
 * Coin conversion: 1 coin = ₦1 = 100 kobo → coinCost = ceil(priceKobo / 100).
 *
 * Auth: required (withAuth).
 * Rate limit: RATE_LIMITS.apiWrite.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import {
  handleApiError,
  badRequest,
  notFound,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { debitCoins, creditCoins } from "@/lib/economy/coins";
import { initializePayment } from "@/lib/payments";
import { requireFeatureEnabled } from "@/lib/manifest";
import type { TransactionClient } from "@/lib/db/interface";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const purchaseSchema = z.object({
  /** UUID of the product being purchased. */
  productId: z.string().uuid("productId must be a valid UUID"),
  /** UUID of the store that owns the product. */
  storeId: z.string().uuid("storeId must be a valid UUID"),
  /** Payment method to use. */
  paymentMethod: z.enum(["coins", "paystack", "dodopayments"]),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface MerchProductRow {
  id: string;
  store_id: string;
  name: string;
  price_kobo: number;
  stock: number | null;
  is_active: boolean;
}

interface MerchStoreRow {
  id: string;
  creator_id: string;
  name: string;
}

interface MerchOrderRow {
  id: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Platform commission on every merch sale. */
const PLATFORM_FEE_PERCENT = 0.2;

/**
 * Convert a kobo price to coins.
 * 1 coin = ₦1 = 100 kobo.
 * We round up to avoid under-charging for fractional kobo.
 */
function koboToCoins(kobo: number): number {
  return Math.ceil(kobo / 100);
}

// ---------------------------------------------------------------------------
// POST /api/merch/purchase
// ---------------------------------------------------------------------------

/**
 * Purchase a creator merch product.
 *
 * @returns
 *   coins path:     { orderId, status, productName, priceKobo }
 *   external path:  { paymentUrl, orderId, message? }
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("merchStore");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, purchaseSchema);
    const buyerId = auth.user.sub;

    // -----------------------------------------------------------------------
    // 1. Load the product
    // -----------------------------------------------------------------------

    const { rows: productRows } = await db.query<MerchProductRow>(
      `SELECT id, store_id, name, price_kobo, stock, is_active
       FROM merch_products
       WHERE id = $1 AND store_id = $2
       LIMIT 1`,
      [body.productId, body.storeId]
    );

    const product = productRows[0];
    if (!product) {
      throw notFound("Product not found in the specified store");
    }

    if (!product.is_active) {
      throw badRequest("This product is no longer available", "PRODUCT_INACTIVE");
    }

    // Stock check: stock IS NULL means unlimited; stock > 0 means available
    if (product.stock !== null && product.stock <= 0) {
      throw badRequest("This product is out of stock", "OUT_OF_STOCK");
    }

    // -----------------------------------------------------------------------
    // 2. Load the store (to get creator_id)
    // -----------------------------------------------------------------------

    const { rows: storeRows } = await db.query<MerchStoreRow>(
      `SELECT id, creator_id, name
       FROM merch_stores
       WHERE id = $1
       LIMIT 1`,
      [body.storeId]
    );

    const store = storeRows[0];
    if (!store) {
      throw notFound("Merch store not found");
    }

    const creatorId = store.creator_id;
    const priceKobo = product.price_kobo;

    // -----------------------------------------------------------------------
    // 3. Compute fees
    // -----------------------------------------------------------------------

    const platformFeeKobo = Math.floor(priceKobo * PLATFORM_FEE_PERCENT);
    const creatorNetKobo = priceKobo - platformFeeKobo;
    const coinCost = koboToCoins(priceKobo);
    const creatorNetCoins = koboToCoins(creatorNetKobo);

    // -----------------------------------------------------------------------
    // 4a. Coin payment — fully atomic transaction
    // -----------------------------------------------------------------------

    if (body.paymentMethod === "coins") {
      let orderId: string;

      await db.transaction(async (tx: TransactionClient) => {
        // a. Debit buyer
        await debitCoins(
          buyerId,
          coinCost,
          "merch_purchase",
          body.productId,
          `Merch purchase: ${product.name} from ${store.name}`,
          {
            productId: body.productId,
            storeId: body.storeId,
            priceKobo,
            platformFeeKobo,
            creatorNetKobo,
          },
          tx
        );

        // b. Insert order record
        const { rows: orderRows } = await tx.query<MerchOrderRow>(
          `INSERT INTO merch_orders
             (store_id, product_id, buyer_id, price_kobo, platform_fee_kobo,
              creator_net_kobo, status, payment_method)
           VALUES ($1, $2, $3, $4, $5, $6, 'processing', 'coins')
           RETURNING id, status`,
          [
            body.storeId,
            body.productId,
            buyerId,
            priceKobo,
            platformFeeKobo,
            creatorNetKobo,
          ]
        );

        orderId = orderRows[0].id;

        // c. Decrement stock if finite
        if (product.stock !== null) {
          const { rows: stockRows } = await tx.query<{ id: string }>(
            `UPDATE merch_products
             SET stock      = stock - 1,
                 updated_at = NOW()
             WHERE id = $1 AND stock > 0
             RETURNING id`,
            [body.productId]
          );

          if (stockRows.length === 0) {
            // Race condition — stock ran out between our initial check and now
            throw badRequest("This product is out of stock", "OUT_OF_STOCK");
          }
        }

        // d. Insert creator_earnings record
        await tx.query(
          `INSERT INTO creator_earnings
             (creator_id, source_type, gross_amount_kobo, platform_fee_kobo, net_amount_kobo)
           VALUES ($1, 'merch_sale', $2, $3, $4)`,
          [creatorId, priceKobo, platformFeeKobo, creatorNetKobo]
        );
        await tx.query(
          `UPDATE users SET available_earnings_kobo = COALESCE(available_earnings_kobo, 0) + $1,
                            updated_at = NOW() WHERE id = $2`,
          [creatorNetKobo, creatorId]
        );

        // e. Credit creator's coins
        await creditCoins(
          creatorId,
          creatorNetCoins,
          "merch_sale",
          orderId!,
          `Merch sale: ${product.name} (order ${orderId!})`,
          {
            orderId: orderId!,
            productId: body.productId,
            storeId: body.storeId,
            buyerId,
            priceKobo,
            platformFeeKobo,
            creatorNetKobo,
          },
          tx
        );
      });

      return NextResponse.json(
        {
          orderId: orderId!,
          status: "processing",
          productName: product.name,
          priceKobo,
        },
        { status: 200 }
      );
    }

    // -----------------------------------------------------------------------
    // 4b. External payment (paystack / dodopayments)
    // -----------------------------------------------------------------------

    // Create a pending order first so we have a reference ID
    const { rows: pendingOrderRows } = await db.query<MerchOrderRow>(
      `INSERT INTO merch_orders
         (store_id, product_id, buyer_id, price_kobo, platform_fee_kobo,
          creator_net_kobo, status, payment_method)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
       RETURNING id, status`,
      [
        body.storeId,
        body.productId,
        buyerId,
        priceKobo,
        platformFeeKobo,
        creatorNetKobo,
        body.paymentMethod,
      ]
    );

    const pendingOrder = pendingOrderRows[0];

    try {
      // Retrieve the buyer's email for the payment provider
      const { rows: userRows } = await db.query<{ email: string | null }>(
        `SELECT email FROM users WHERE id = $1 LIMIT 1`,
        [buyerId]
      );

      const buyerEmail = userRows[0]?.email ?? "noreply@zobia.app";
      const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.app"}/merch/order/${pendingOrder.id}`;

      const paymentResult = await initializePayment(
        priceKobo,
        "NGN",
        buyerEmail,
        /* idempotencyKey */ `merch:${pendingOrder.id}`,
        {
          orderId: pendingOrder.id,
          productId: body.productId,
          storeId: body.storeId,
          buyerId,
        },
        returnUrl
      );

      // Persist the provider reference so the webhook can match it
      await db.query(
        `UPDATE merch_orders
         SET provider_reference = $1, updated_at = NOW()
         WHERE id = $2`,
        [paymentResult.providerReference, pendingOrder.id]
      );

      return NextResponse.json(
        {
          paymentUrl: paymentResult.paymentUrl,
          orderId: pendingOrder.id,
        },
        { status: 200 }
      );
    } catch (paymentErr) {
      // Mark the pending order as failed so it can be retried or investigated.
      await db.query(
        `UPDATE merch_orders SET status = 'failed', updated_at = NOW() WHERE id = $1`,
        [pendingOrder.id]
      ).catch(() => {});

      // Log for monitoring/alerting and surface a clean error to the client.
      console.error("[merch/purchase] Payment initialisation failed:", paymentErr);

      return NextResponse.json(
        {
          success: false,
          error: "Payment provider unavailable. Please try again or pay with Coins.",
          orderId: pendingOrder.id,
        },
        { status: 503 }
      );
    }
  } catch (err) {
    return handleApiError(err);
  }
});
