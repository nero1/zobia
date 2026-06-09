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
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { initializePayment } from "@/lib/payments";
import { loadManifest } from "@/lib/manifest";
import { env } from "@/lib/env";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const StarPurchaseSchema = z.object({
  packId: z.string().uuid("packId must be a valid UUID"),
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
  stars_granted: number;
  is_active: boolean;
}

interface UserRow {
  id: string;
  email: string | null;
  username: string;
}

// ---------------------------------------------------------------------------
// POST /api/economy/stars/purchase
// ---------------------------------------------------------------------------

/**
 * Initiate a Stars pack purchase.
 *
 * Body: { packId: string, paymentProvider?: "paystack" | "dodopayments" }
 * Returns: { paymentUrl: string, paymentReference: string, pack: {...} }
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    // 1. Check admin toggle — star direct purchase can be disabled globally
    const { rows: flagRows } = await db.query<{ value: string }>(
      `SELECT value FROM x_manifest WHERE key = 'feature_star_purchase_enabled' LIMIT 1`
    );
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
    const { rows: packRows } = await db.query<StoreItemRow>(
      `SELECT id, name, item_type, price_kobo, currency,
              COALESCE(stars_granted, 0) AS stars_granted, is_active
       FROM store_items
       WHERE id = $1 AND item_type = 'star_pack'
       LIMIT 1`,
      [body.packId]
    );

    if (!packRows[0]) throw notFound("Star pack not found");
    const pack = packRows[0];

    if (!pack.is_active) {
      throw badRequest("This star pack is currently unavailable");
    }

    if (pack.stars_granted <= 0) {
      throw badRequest("Invalid star pack configuration");
    }

    // 3. Load user email (needed by payment providers)
    const { rows: userRows } = await db.query<UserRow>(
      `SELECT id, email, username FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    if (!userRows[0]) throw badRequest("User not found");

    const user = userRows[0];
    const email = user.email ?? `${user.username}@zobia.app`;

    // 4. Idempotency: reuse an existing pending session for the same user+pack+day
    const today = new Date().toISOString().slice(0, 10);
    const idempotencyKey = `star_purchase:${userId}:${body.packId}:${today}:${randomUUID()}`;

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
      [`star_purchase:${userId}:${body.packId}:${today}%`]
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
      starsGranted: pack.stars_granted,
      itemType: "star_pack",
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
        starsGranted: pack.stars_granted,
        priceKobo: pack.price_kobo,
        currency: pack.currency,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
