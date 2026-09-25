export const dynamic = 'force-dynamic';

/**
 * app/api/merch/purchase/route.ts
 *
 * POST /api/merch/purchase
 *
 * Purchase a creator merch product. Supports three payment methods:
 *   - coins    → Atomic coin debit + creator credit (in-app currency)
 *   - paystack → Redirect to Paystack checkout
 *   - crypto   → Pay with JAGA / BNB / SOL (user-initiated on-chain
 *                transfer — see lib/payments/crypto/; requires `cryptoCurrency`)
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
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import {
  handleApiError,
  badRequest,
  notFound,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { debitCoins, creditCoins } from "@/lib/economy/coins";
import { initializePayment } from "@/lib/payments";
import { serializeComputedAmount, type ComputedAmount } from "@/lib/payments/crypto";
import { requireFeatureEnabled } from "@/lib/manifest";
import { enforcePaymentContext, getUserIsNigeria } from "@/lib/payments/contextSettings";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const purchaseSchema = z.object({
  /** UUID of the product being purchased. */
  productId: z.string().uuid("productId must be a valid UUID"),
  /** UUID of the store that owns the product. */
  storeId: z.string().uuid("storeId must be a valid UUID"),
  /** Payment method to use. */
  paymentMethod: z.enum(["coins", "paystack", "crypto"]),
  /** Required when paymentMethod === "crypto". */
  cryptoCurrency: z.enum(["JAGA", "BNB", "SOL"]).optional(),
});

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
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await requireFeatureEnabled("merchStore");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, purchaseSchema);
    const buyerId = auth.user.sub;
    const orm = await getDb();

    // -----------------------------------------------------------------------
    // 1. Load the product
    // -----------------------------------------------------------------------

    const productRows = await orm
      .select({
        id: schema.merchProducts.id,
        storeId: schema.merchProducts.storeId,
        name: schema.merchProducts.name,
        priceKobo: schema.merchProducts.priceKobo,
        stock: schema.merchProducts.stock,
        isActive: schema.merchProducts.isActive,
      })
      .from(schema.merchProducts)
      .where(and(eq(schema.merchProducts.id, body.productId), eq(schema.merchProducts.storeId, body.storeId)))
      .limit(1);

    const productRow = productRows[0];
    if (!productRow) {
      throw notFound("Product not found in the specified store");
    }
    const product = { ...productRow, priceKobo: Number(productRow.priceKobo) };

    if (!product.isActive) {
      throw badRequest("This product is no longer available", "PRODUCT_INACTIVE");
    }

    // Stock check: stock IS NULL means unlimited; stock > 0 means available
    if (product.stock !== null && product.stock <= 0) {
      throw badRequest("This product is out of stock", "OUT_OF_STOCK");
    }

    // -----------------------------------------------------------------------
    // 2. Load the store (to get creator_id)
    // -----------------------------------------------------------------------

    const storeRows = await orm
      .select({ id: schema.merchStores.id, creatorId: schema.merchStores.creatorId, name: schema.merchStores.name })
      .from(schema.merchStores)
      .where(eq(schema.merchStores.id, body.storeId))
      .limit(1);

    const store = storeRows[0];
    if (!store) {
      throw notFound("Merch store not found");
    }

    const creatorId = store.creatorId;
    const priceKobo = product.priceKobo;

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

      await orm.transaction(async (tx) => {
        // a. Insert order record first so we have a fresh, per-purchase order ID to
        // use as the debit reference (SYS-CL-09: the bare productId collided across
        // repeat purchases of the same product, including by different buyers).
        const orderRows = await tx
          .insert(schema.merchOrders)
          .values({
            storeId: body.storeId,
            productId: body.productId,
            buyerId,
            priceKobo: BigInt(priceKobo),
            platformFeeKobo: BigInt(platformFeeKobo),
            creatorNetKobo: BigInt(creatorNetKobo),
            status: "processing",
            paymentMethod: "coins",
          })
          .returning({ id: schema.merchOrders.id, status: schema.merchOrders.status });

        orderId = orderRows[0].id;

        // b. Debit buyer
        await debitCoins(
          buyerId,
          coinCost,
          "merch_purchase",
          orderId,
          `Merch purchase: ${product.name} from ${store.name}`,
          {
            productId: body.productId,
            storeId: body.storeId,
            priceKobo,
            platformFeeKobo,
            creatorNetKobo,
          },
          tx as never
        );

        // c. Decrement stock if finite
        if (product.stock !== null) {
          const stockRows = await tx
            .update(schema.merchProducts)
            .set({ stock: sql`${schema.merchProducts.stock} - 1`, updatedAt: sql`NOW()` })
            .where(and(eq(schema.merchProducts.id, body.productId), gt(schema.merchProducts.stock, 0)))
            .returning({ id: schema.merchProducts.id });

          if (stockRows.length === 0) {
            // Race condition — stock ran out between our initial check and now
            throw badRequest("This product is out of stock", "OUT_OF_STOCK");
          }
        }

        // d. Insert creator_earnings record
        await tx.insert(schema.creatorEarnings).values({
          creatorId,
          sourceType: "merch_sale",
          grossAmountKobo: BigInt(priceKobo),
          platformFeeKobo: BigInt(platformFeeKobo),
          netAmountKobo: BigInt(creatorNetKobo),
        });
        await tx
          .update(schema.users)
          .set({
            availableEarningsKobo: sql`COALESCE(${schema.users.availableEarningsKobo}, 0) + ${creatorNetKobo}`,
            updatedAt: sql`NOW()`,
          })
          .where(eq(schema.users.id, creatorId));

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
          tx as never
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
    // 4b. External payment (paystack / crypto) — server-side re-validated
    // against payment_context_settings("merch_purchase"); a client cannot
    // bypass an admin-disabled provider/currency by calling this API directly.
    // -----------------------------------------------------------------------
    const isNigeria = await getUserIsNigeria(buyerId);
    const decision = await enforcePaymentContext("merch_purchase", isNigeria, body.paymentMethod, body.cryptoCurrency);

    if (decision.isFree) {
      let orderId: string;
      await orm.transaction(async (tx) => {
        const orderRows = await tx
          .insert(schema.merchOrders)
          .values({
            storeId: body.storeId,
            productId: body.productId,
            buyerId,
            priceKobo: BigInt(priceKobo),
            platformFeeKobo: BigInt(platformFeeKobo),
            creatorNetKobo: BigInt(creatorNetKobo),
            status: "processing",
            paymentMethod: "free",
          })
          .returning({ id: schema.merchOrders.id, status: schema.merchOrders.status });
        orderId = orderRows[0].id;

        if (product.stock !== null) {
          const stockRows = await tx
            .update(schema.merchProducts)
            .set({ stock: sql`${schema.merchProducts.stock} - 1`, updatedAt: sql`NOW()` })
            .where(and(eq(schema.merchProducts.id, body.productId), gt(schema.merchProducts.stock, 0)))
            .returning({ id: schema.merchProducts.id });
          if (stockRows.length === 0) throw badRequest("This product is out of stock", "OUT_OF_STOCK");
        }

        await tx.insert(schema.creatorEarnings).values({
          creatorId,
          sourceType: "merch_sale",
          grossAmountKobo: BigInt(priceKobo),
          platformFeeKobo: BigInt(platformFeeKobo),
          netAmountKobo: BigInt(creatorNetKobo),
        });
        await tx
          .update(schema.users)
          .set({
            availableEarningsKobo: sql`COALESCE(${schema.users.availableEarningsKobo}, 0) + ${creatorNetKobo}`,
            updatedAt: sql`NOW()`,
          })
          .where(eq(schema.users.id, creatorId));
        await tx
          .update(schema.merchOrders)
          .set({ status: "completed", updatedAt: sql`NOW()` })
          .where(eq(schema.merchOrders.id, orderId!));
      });

      logger.info({ orderId: orderId!, buyerId, productId: body.productId }, "[merch/purchase] Granted free merch order (admin is_free toggle)");

      return NextResponse.json(
        { orderId: orderId!, status: "completed", productName: product.name, priceKobo, free: true },
        { status: 200 }
      );
    }

    if (decision.provider === "crypto" && !body.cryptoCurrency) {
      throw badRequest("cryptoCurrency is required when paymentMethod is 'crypto'");
    }

    // Create a pending order first so we have a reference ID
    const pendingOrderRows = await orm
      .insert(schema.merchOrders)
      .values({
        storeId: body.storeId,
        productId: body.productId,
        buyerId,
        priceKobo: BigInt(priceKobo),
        platformFeeKobo: BigInt(platformFeeKobo),
        creatorNetKobo: BigInt(creatorNetKobo),
        status: "pending",
        paymentMethod: body.paymentMethod,
      })
      .returning({ id: schema.merchOrders.id, status: schema.merchOrders.status });

    const pendingOrder = pendingOrderRows[0];

    try {
      // Retrieve the buyer's email for the payment provider
      const userRows = await orm
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, buyerId))
        .limit(1);

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
          ...(body.paymentMethod === "crypto" ? { cryptoCurrency: body.cryptoCurrency } : {}),
        },
        returnUrl,
        body.paymentMethod === "crypto" ? "crypto" : "paystack"
      );

      // Persist the provider reference so the webhook can match it
      await orm
        .update(schema.merchOrders)
        .set({ providerReference: paymentResult.providerReference, updatedAt: sql`NOW()` })
        .where(eq(schema.merchOrders.id, pendingOrder.id));

      return NextResponse.json(
        {
          paymentUrl: paymentResult.paymentUrl,
          orderId: pendingOrder.id,
          providerReference: paymentResult.providerReference,
          // Present only for paymentMethod === "crypto" — the client uses this
          // to drive the wallet-connect / send flow (see ComputedAmount).
          crypto: body.paymentMethod === "crypto" ? serializeComputedAmount(paymentResult.raw as ComputedAmount) : undefined,
        },
        { status: 200 }
      );
    } catch (paymentErr) {
      // Mark the pending order as failed so it can be retried or investigated.
      await orm
        .update(schema.merchOrders)
        .set({ status: "failed", updatedAt: sql`NOW()` })
        .where(eq(schema.merchOrders.id, pendingOrder.id))
        .catch(() => {});

      // Log for monitoring/alerting and surface a clean error to the client.
      logger.error({ err: paymentErr }, "[merch/purchase] Payment initialisation failed:");

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
