export const dynamic = 'force-dynamic';

/**
 * POST /api/economy/coins/purchase
 *
 * Initiates a coin pack purchase for the authenticated user.
 *
 * Flow:
 *   1. Validate the requested pack ID exists in the database
 *   2. Generate a unique idempotency key
 *   3. Persist a pending payment record
 *   4. Initialize payment with the active provider
 *   5. Return the payment URL for client redirect
 *
 * The actual coin credit happens in the webhook handler after payment confirmation.
 *
 * @module app/api/economy/coins/purchase
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, gt, isNull, isNotNull, or, sql } from "drizzle-orm";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { initializePayment } from "@/lib/payments";
import { serializeComputedAmount, type ComputedAmount } from "@/lib/payments/crypto";
import { env } from "@/lib/env";
import { enforcePaymentContext, getUserIsNigeria } from "@/lib/payments/contextSettings";
import { grantFreePayment } from "@/lib/payments/freeGrant";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const PurchaseSchema = z.object({
  /** ID of the coin pack from the store_items table. */
  packId: z.string().uuid("packId must be a valid UUID"),
  /**
   * Payment provider to use. If omitted the active manifest provider is used.
   * Explicitly specifying allows mobile apps to force a provider.
   */
  paymentProvider: z.enum(["paystack", "crypto"]).optional(),
  /** Required when paymentProvider === "crypto". */
  cryptoCurrency: z.enum(["JAGA", "BNB", "SOL"]).optional(),
  /**
   * Client-generated UUID for idempotency. The same value on a retry reuses
   * the existing pending payment; a new UUID starts a fresh payment session.
   * If omitted, each call creates a new payment.
   */
  clientRequestId: z.string().uuid("clientRequestId must be a valid UUID").optional(),
  /**
   * Where the purchased Credits land. "ad_wallet" routes the webhook's
   * credit into the Ad Wallet (lib/economy/adWallet.ts) instead of the main
   * coin_balance — used by the "Buy Credits" button on the Ads Wallet panel.
   */
  destination: z.enum(["main_wallet", "ad_wallet"]).default("main_wallet"),
});

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/economy/coins/purchase
 *
 * Body: { packId: string, paymentProvider?: "paystack" | "crypto", cryptoCurrency?: "JAGA" | "BNB" | "SOL" }
 * Returns: { paymentUrl: string, paymentReference: string }
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.coinPurchase);

    const body = await validateBody(req, PurchaseSchema);
    const userId = auth.user.sub;
    const orm = await getDb();

    // 1. Load the pack from the database
    const packRows = await orm
      .select({
        id: schema.storeItems.id,
        name: schema.storeItems.name,
        itemType: schema.storeItems.itemType,
        priceKobo: schema.storeItems.priceKobo,
        currency: schema.storeItems.currency,
        coinsGranted: schema.storeItems.coinsGranted,
        isActive: schema.storeItems.isActive,
      })
      .from(schema.storeItems)
      .where(
        and(
          eq(schema.storeItems.id, body.packId),
          or(eq(schema.storeItems.itemType, "coin_pack"), eq(schema.storeItems.itemType, "star_pack"))
        )
      )
      .limit(1);

    if (!packRows[0]) {
      throw notFound("Coin pack not found");
    }

    const pack = packRows[0];

    if (!pack.isActive) {
      throw badRequest("This pack is currently unavailable");
    }

    // 2. Load the user's email (needed by Paystack)
    const userRows = await orm
      .select({ id: schema.users.id, email: schema.users.email, username: schema.users.username })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);

    if (!userRows[0]) {
      throw badRequest("User not found");
    }

    const user = userRows[0];
    const email = user.email ?? `${user.username}@zobia.app`;

    // 3. Generate idempotency key — keyed on client-provided request ID so the
    //    same tap (network retry) reuses the pending record while a second
    //    intentional purchase creates a new one.
    const requestId = body.clientRequestId ?? crypto.randomUUID();
    const idempotencyKey = `purchase:${userId}:${body.packId}:${requestId}`;

    // 4. Check for an already-completed pending payment for this exact key (within 10 minutes).
    // Only return cached data when provider_reference is set — otherwise the payment is still
    // being initialised by a concurrent request and we should wait for it to resolve rather
    // than returning null payment details.
    const existingRows = await orm
      .select({
        metadata: schema.payments.metadata,
        providerReference: schema.payments.providerReference,
      })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.idempotencyKey, idempotencyKey),
          eq(schema.payments.status, "pending"),
          isNotNull(schema.payments.providerReference),
          gt(schema.payments.createdAt, sql`NOW() - INTERVAL '10 minutes'`)
        )
      )
      .limit(1);

    if (existingRows[0]) {
      const existingMetadata = (existingRows[0].metadata ?? {}) as Record<string, unknown>;
      return NextResponse.json({
        paymentUrl: existingMetadata.payment_url,
        paymentReference: existingRows[0].providerReference,
        reused: true,
      });
    }

    const returnUrl = `${env.NEXT_PUBLIC_APP_URL}/economy/purchase/callback`;

    // Server-side enforcement of the admin-configured payment_context_settings
    // for this pack type — never trust the client's requested provider/currency
    // without re-checking it here (a client could otherwise bypass the
    // gate44/payments toggles by calling this API directly).
    const contextKey = pack.itemType === "star_pack" ? "star_purchase" : "coin_purchase";
    const isNigeria = await getUserIsNigeria(userId);
    const decision = await enforcePaymentContext(contextKey, isNigeria, body.paymentProvider, body.cryptoCurrency);

    const priceKobo = Number(pack.priceKobo);

    const metadata = {
      userId,
      packId: pack.id,
      packName: pack.name,
      coinsGranted: pack.coinsGranted,
      itemType: pack.itemType,
      destination: body.destination,
      ...(!decision.isFree && decision.provider === "crypto" ? { cryptoCurrency: decision.cryptoCurrency } : {}),
    };

    // Admin has flipped this context free — grant immediately, no provider involved.
    if (decision.isFree) {
      await grantFreePayment({
        userId,
        paymentType: "coin_purchase",
        amountKobo: priceKobo,
        currency: pack.currency,
        idempotencyKey,
        metadata: metadata as never,
      });
      return NextResponse.json({
        paymentUrl: "",
        paymentReference: idempotencyKey,
        free: true,
        pack: { id: pack.id, name: pack.name, coinsGranted: pack.coinsGranted, priceKobo, currency: pack.currency },
      });
    }

    const provider = decision.provider;

    // 5. Persist the payment record FIRST (provider_reference NULL until the provider call
    //    succeeds). This ensures that if the provider call succeeds but our subsequent DB
    //    UPDATE fails, we still have an auditable record of the attempt rather than an
    //    untracked real payment with no local record.
    const insertRows = await orm
      .insert(schema.payments)
      .values({
        userId,
        paymentType: "coin_purchase",
        amountKobo: pack.priceKobo,
        currency: pack.currency,
        provider,
        status: "pending",
        idempotencyKey,
        metadata,
      })
      .onConflictDoNothing({ target: schema.payments.idempotencyKey })
      .returning({ id: schema.payments.id });

    const paymentDbId = insertRows[0]?.id;

    // 6. Initialize payment with the provider
    let paymentResult: { paymentUrl: string; providerReference: string; raw: unknown };
    try {
      paymentResult = await initializePayment(
        priceKobo,
        pack.currency,
        email,
        idempotencyKey,
        metadata,
        returnUrl,
        provider
      );
    } catch (providerErr) {
      // Provider call failed — mark the record so it is not retried as 'pending'
      if (paymentDbId) {
        await orm
          .update(schema.payments)
          .set({ status: "failed", updatedAt: sql`NOW()` })
          .where(eq(schema.payments.id, paymentDbId))
          .catch(() => {});
      }
      throw providerErr;
    }

    // 7. Stamp the provider reference and payment URL onto the record
    const metadataWithUrl = { ...metadata, payment_url: paymentResult.paymentUrl };
    if (paymentDbId) {
      await orm
        .update(schema.payments)
        .set({
          providerReference: paymentResult.providerReference,
          metadata: metadataWithUrl,
          updatedAt: sql`NOW()`,
        })
        .where(eq(schema.payments.id, paymentDbId));
    }

    if (provider === "crypto" && paymentDbId) {
      const { applyCryptoComputedAmount } = await import("@/lib/payments/crypto");
      await applyCryptoComputedAmount(paymentDbId, paymentResult.raw);
    }

    return NextResponse.json({
      paymentUrl: paymentResult.paymentUrl,
      paymentReference: paymentResult.providerReference,
      crypto: provider === "crypto" ? serializeComputedAmount(paymentResult.raw as ComputedAmount) : undefined,
      pack: {
        id: pack.id,
        name: pack.name,
        coinsGranted: pack.coinsGranted,
        priceKobo,
        currency: pack.currency,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
