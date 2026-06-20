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
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { initializePayment } from "@/lib/payments";
import { loadManifest } from "@/lib/manifest";
import { env } from "@/lib/env";

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
  paymentProvider: z.enum(["paystack", "dodopayments"]).optional(),
  /**
   * Client-generated UUID for idempotency. The same value on a retry reuses
   * the existing pending payment; a new UUID starts a fresh payment session.
   * If omitted, each call creates a new payment.
   */
  clientRequestId: z.string().uuid("clientRequestId must be a valid UUID").optional(),
});

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface StoreItemRow {
  id: string;
  name: string;
  item_type: string;
  price_kobo: number;
  currency: string;
  coins_granted: number;
  is_active: boolean;
}

interface UserRow {
  id: string;
  email: string | null;
  username: string;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/economy/coins/purchase
 *
 * Body: { packId: string, paymentProvider?: "paystack" | "dodopayments" }
 * Returns: { paymentUrl: string, paymentReference: string }
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.coinPurchase);

    const body = await validateBody(req, PurchaseSchema);
    const userId = auth.user.sub;

    // 1. Load the pack from the database
    const { rows: packRows } = await db.query<StoreItemRow>(
      `SELECT id, name, item_type, price_kobo, currency, coins_granted, is_active
       FROM store_items
       WHERE id = $1 AND item_type IN ('coin_pack', 'star_pack') LIMIT 1`,
      [body.packId]
    );

    if (!packRows[0]) {
      throw notFound("Coin pack not found");
    }

    const pack = packRows[0];

    if (!pack.is_active) {
      throw badRequest("This pack is currently unavailable");
    }

    // 2. Load the user's email (needed by Paystack)
    const { rows: userRows } = await db.query<UserRow>(
      `SELECT id, email, username FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

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
    const { rows: existingRows } = await db.query<{
      payment_url: string;
      provider_reference: string;
    }>(
      `SELECT metadata->>'payment_url' AS payment_url, provider_reference
       FROM payments
       WHERE idempotency_key = $1
         AND status = 'pending'
         AND provider_reference IS NOT NULL
         AND created_at > NOW() - INTERVAL '10 minutes'
       LIMIT 1`,
      [idempotencyKey]
    );

    if (existingRows[0]) {
      return NextResponse.json({
        paymentUrl: existingRows[0].payment_url,
        paymentReference: existingRows[0].provider_reference,
        reused: true,
      });
    }

    const returnUrl = `${env.NEXT_PUBLIC_APP_URL}/economy/purchase/callback`;
    const metadata = {
      userId,
      packId: pack.id,
      packName: pack.name,
      coinsGranted: pack.coins_granted,
      itemType: pack.item_type,
    };

    const manifest = await loadManifest();
    const VALID_PROVIDERS = ["paystack", "dodopayments"] as const;
    type Provider = typeof VALID_PROVIDERS[number];
    const requestedProvider = body.paymentProvider;
    let provider: Provider;
    if (requestedProvider && (VALID_PROVIDERS as readonly string[]).includes(requestedProvider)) {
      provider = requestedProvider as Provider;
    } else if (requestedProvider) {
      throw badRequest(`Payment provider '${requestedProvider}' is not active`, "INVALID_PROVIDER");
    } else {
      provider = manifest.payment.primaryProvider as Provider;
    }

    // 5. Persist the payment record FIRST (provider_reference NULL until the provider call
    //    succeeds). This ensures that if the provider call succeeds but our subsequent DB
    //    UPDATE fails, we still have an auditable record of the attempt rather than an
    //    untracked real payment with no local record.
    const { rows: insertRows } = await db.query<{ id: string }>(
      `INSERT INTO payments
         (user_id, payment_type, amount_kobo, currency, provider, status,
          idempotency_key, metadata)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        userId,
        'coin_purchase',
        pack.price_kobo,
        pack.currency,
        provider,
        idempotencyKey,
        JSON.stringify(metadata),
      ]
    );

    const paymentDbId = insertRows[0]?.id;

    // 6. Initialize payment with the provider
    let paymentResult: { paymentUrl: string; providerReference: string };
    try {
      paymentResult = await initializePayment(
        pack.price_kobo,
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
        await db.query(
          `UPDATE payments SET status = 'failed' WHERE id = $1`,
          [paymentDbId]
        ).catch(() => {});
      }
      throw providerErr;
    }

    // 7. Stamp the provider reference and payment URL onto the record
    const metadataWithUrl = { ...metadata, payment_url: paymentResult.paymentUrl };
    await db.query(
      `UPDATE payments
       SET provider_reference = $1, metadata = $2
       WHERE id = $3`,
      [paymentResult.providerReference, JSON.stringify(metadataWithUrl), paymentDbId]
    );

    return NextResponse.json({
      paymentUrl: paymentResult.paymentUrl,
      paymentReference: paymentResult.providerReference,
      pack: {
        id: pack.id,
        name: pack.name,
        coinsGranted: pack.coins_granted,
        priceKobo: pack.price_kobo,
        currency: pack.currency,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
