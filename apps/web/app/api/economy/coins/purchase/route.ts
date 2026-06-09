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
import { randomUUID } from "crypto";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
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

    // 3. Generate idempotency key — deterministic per user+pack+day so duplicate
    //    taps within the same day reuse the same pending record rather than
    //    creating multiple payment sessions.
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const idempotencyKey = `purchase:${userId}:${body.packId}:${today}:${randomUUID()}`;

    // 4. Check for an already-pending payment for this key (within 10 minutes)
    const { rows: existingRows } = await db.query<{
      payment_url: string;
      provider_reference: string;
    }>(
      `SELECT metadata->>'payment_url' AS payment_url, provider_reference
       FROM payments
       WHERE idempotency_key LIKE $1
         AND status = 'pending'
         AND created_at > NOW() - INTERVAL '10 minutes'
       LIMIT 1`,
      [`purchase:${userId}:${body.packId}:${today}%`]
    );

    if (existingRows[0]) {
      return NextResponse.json({
        paymentUrl: existingRows[0].payment_url,
        paymentReference: existingRows[0].provider_reference,
        reused: true,
      });
    }

    // 5. Initialize payment with the provider
    const returnUrl = `${env.NEXT_PUBLIC_APP_URL}/economy/purchase/callback`;
    const metadata = {
      userId,
      packId: pack.id,
      packName: pack.name,
      coinsGranted: pack.coins_granted,
      itemType: pack.item_type,
    };

    const manifest = await loadManifest();
    const provider = manifest.payment.primaryProvider as "paystack" | "dodopayments";

    const paymentResult = await initializePayment(
      pack.price_kobo,
      pack.currency,
      email,
      idempotencyKey,
      metadata,
      returnUrl
    );

    const metadataWithUrl = { ...metadata, payment_url: paymentResult.paymentUrl };

    // 6. Persist the pending payment record
    await db.query(
      `INSERT INTO payments
         (user_id, payment_type, amount_kobo, currency, provider, status,
          idempotency_key, provider_reference, metadata)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8)`,
      [
        userId,
        'coin_purchase',
        pack.price_kobo,
        pack.currency,
        provider,
        idempotencyKey,
        paymentResult.providerReference,
        JSON.stringify(metadataWithUrl),
      ]
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
