export const dynamic = 'force-dynamic';

/**
 * app/api/economy/stars/purchase/route.ts
 *
 * POST /api/economy/stars/purchase
 *
 * Initiates a Stars pack purchase for the authenticated user.
 *
 * Stars are a scarce prestige currency (PRD §11). Direct purchase requires
 * the `feature_star_purchase_enabled` manifest flag to be set to "true".
 *
 * Flow:
 *   1. Check admin toggle — star purchase can be disabled globally
 *   2. Validate the requested pack is an active star_pack in store_items
 *   3. Generate idempotency key to prevent duplicate sessions
 *   4. Initialize payment with the active provider
 *   5. Persist a pending payment record
 *   6. Return the payment URL for client redirect
 *
 * The actual star credit happens in the payment webhook handler after
 * payment confirmation, keyed on `itemType = 'star_pack'` in metadata.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { and, eq, gt, isNull, like, sql } from "drizzle-orm";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { initializePayment } from "@/lib/payments";
import { serializeComputedAmount, type ComputedAmount } from "@/lib/payments/crypto";
import { env } from "@/lib/env";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { enforcePaymentContext, getUserIsNigeria } from "@/lib/payments/contextSettings";
import { grantFreePayment } from "@/lib/payments/freeGrant";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const StarPurchaseSchema = z.object({
  packId: z.string().uuid("packId must be a valid UUID"),
  paymentProvider: z.enum(["paystack", "crypto"]).optional(),
  /** Required when paymentProvider === "crypto". */
  cryptoCurrency: z.enum(["JAGA", "BNB", "SOL"]).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/economy/stars/purchase
// ---------------------------------------------------------------------------

/**
 * Initiate a Stars pack purchase.
 *
 * Body: { packId: string, paymentProvider?: "paystack" | "crypto", cryptoCurrency?: "JAGA" | "BNB" | "SOL" }
 * Returns: { paymentUrl: string, paymentReference: string, pack: {...} }
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const orm = await getDb();

    // 1. Check admin toggle — star direct purchase can be disabled globally
    const flagRows = await orm
      .select({ value: schema.xManifest.value })
      .from(schema.xManifest)
      .where(eq(schema.xManifest.key, "feature_star_purchase_enabled"))
      .limit(1);
    const starPurchaseEnabled = (flagRows[0]?.value ?? "true") === "true";
    if (!starPurchaseEnabled) {
      throw badRequest(
        "Star purchases are currently unavailable. Check back soon.",
        "STAR_PURCHASE_DISABLED"
      );
    }

    const body = await validateBody(req, StarPurchaseSchema);
    const userId = auth.user.sub;

    // 2. Load the star pack from the database
    const packRows = await orm
      .select({
        id: schema.storeItems.id,
        name: schema.storeItems.name,
        itemType: schema.storeItems.itemType,
        priceKobo: schema.storeItems.priceKobo,
        currency: schema.storeItems.currency,
        starsGranted: schema.storeItems.starsGranted,
        isActive: schema.storeItems.isActive,
      })
      .from(schema.storeItems)
      .where(and(eq(schema.storeItems.id, body.packId), eq(schema.storeItems.itemType, "star_pack")))
      .limit(1);

    if (!packRows[0]) throw notFound("Star pack not found");
    const pack = packRows[0];
    const starsGranted = pack.starsGranted ?? 0;

    if (!pack.isActive) {
      throw badRequest("This star pack is currently unavailable");
    }

    if (starsGranted <= 0) {
      throw badRequest("Invalid star pack configuration");
    }

    // 3. Load user email (needed by payment providers)
    const userRows = await orm
      .select({ id: schema.users.id, email: schema.users.email, username: schema.users.username })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!userRows[0]) throw badRequest("User not found");

    const user = userRows[0];
    const email = user.email ?? `${user.username}@zobia.app`;

    // 4. Idempotency: reuse an existing pending session for the same user+pack+day
    const today = new Date().toISOString().slice(0, 10);
    const idempotencyKey = `star_purchase:${userId}:${body.packId}:${today}:${randomUUID()}`;

    const existingRows = await orm
      .select({
        metadata: schema.payments.metadata,
        providerReference: schema.payments.providerReference,
      })
      .from(schema.payments)
      .where(
        and(
          like(schema.payments.idempotencyKey, `star_purchase:${userId}:${body.packId}:${today}%`),
          eq(schema.payments.status, "pending"),
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

    // 5. Initialize payment with the provider
    const returnUrl = `${env.NEXT_PUBLIC_APP_URL}/economy/purchase/callback`;

    const isNigeria = await getUserIsNigeria(userId);
    const decision = await enforcePaymentContext("star_purchase", isNigeria, body.paymentProvider, body.cryptoCurrency);

    const priceKobo = Number(pack.priceKobo);

    const metadata = {
      userId,
      packId: pack.id,
      packName: pack.name,
      starsGranted,
      itemType: "star_pack",
      ...(!decision.isFree && decision.provider === "crypto" ? { cryptoCurrency: decision.cryptoCurrency } : {}),
    };

    if (decision.isFree) {
      await grantFreePayment({
        userId,
        paymentType: "star_purchase",
        amountKobo: priceKobo,
        currency: pack.currency,
        idempotencyKey,
        metadata: metadata as never,
      });
      return NextResponse.json({
        paymentUrl: "",
        paymentReference: idempotencyKey,
        free: true,
        pack: { id: pack.id, name: pack.name, starsGranted, priceKobo, currency: pack.currency },
      });
    }

    const provider = decision.provider;

    const paymentResult = await initializePayment(
      priceKobo,
      pack.currency,
      email,
      idempotencyKey,
      metadata,
      returnUrl,
      provider
    );

    const metadataWithUrl = { ...metadata, payment_url: paymentResult.paymentUrl };
    const computed = provider === "crypto" ? (paymentResult.raw as ComputedAmount) : null;

    // 6. Persist the pending payment record
    await orm.insert(schema.payments).values({
      userId,
      paymentType: "star_purchase", // BUG-FIN-18: was 'coin_purchase'; this is a star pack
      amountKobo: pack.priceKobo,
      currency: pack.currency,
      provider,
      status: "pending",
      idempotencyKey,
      providerReference: paymentResult.providerReference,
      metadata: metadataWithUrl,
      chain: computed?.chain ?? null,
      tokenSymbol: computed?.currency ?? null,
      walletAddress: computed?.receivingAddress ?? null,
      expectedTokenAmount: computed ? computed.expectedBaseUnits.toString() : null,
    });

    return NextResponse.json({
      paymentUrl: paymentResult.paymentUrl,
      paymentReference: paymentResult.providerReference,
      crypto: computed ? serializeComputedAmount(computed) : null,
      pack: {
        id: pack.id,
        name: pack.name,
        starsGranted,
        priceKobo,
        currency: pack.currency,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
