export const dynamic = 'force-dynamic';

/**
 * app/api/economy/iap/verify/route.ts
 *
 * Google Play server-side purchase verification.
 *
 * POST /api/economy/iap/verify
 *   - Validates JWT auth (withAuth middleware)
 *   - Verifies the purchase token with the Google Play Developer API
 *   - Checks idempotency via coin_ledger reference field
 *   - Credits coins atomically via creditCoins
 *   - Acknowledges (consumes) the purchase on Google Play
 *   - Returns { success: true, coinsGranted: number }
 *
 * Security: SELECT FOR UPDATE prevents race conditions.
 * Returns 409 if purchaseToken was already processed.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, conflict, internalError } from "@/lib/api/errors";
import { creditCoins } from "@/lib/economy/coins";
import { db } from "@/lib/db";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maps Google Play one-time product IDs to coin amounts.
 * Must stay in sync with apps/expo/lib/payments/googlePlay.ts COIN_PRODUCTS.
 */
const COIN_PRODUCTS: Record<string, number> = {
  coins_starter: 100,
  coins_regular: 350,
  coins_big: 800,
  coins_baller: 1800,
  coins_boss: 5000,
  coins_legend: 11500,
};

/**
 * Maps Google Play subscription product IDs to plan tiers and monthly coin bonuses.
 * Must stay in sync with apps/expo/lib/payments/googlePlay.ts SUBSCRIPTION_PRODUCTS.
 */
const SUBSCRIPTION_PRODUCTS: Record<string, { plan: string; monthlyCoins: number }> = {
  sub_plus_monthly:  { plan: "plus", monthlyCoins: 50 },
  sub_pro_monthly:   { plan: "pro",  monthlyCoins: 200 },
  sub_max_monthly:   { plan: "max",  monthlyCoins: 500 },
  sub_plus_annual:   { plan: "plus", monthlyCoins: 50 },
  sub_pro_annual:    { plan: "pro",  monthlyCoins: 200 },
  sub_max_annual:    { plan: "max",  monthlyCoins: 500 },
};

const GOOGLE_PLAY_API_BASE =
  "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const verifyIapSchema = z.object({
  purchaseToken: z.string().min(1, "purchaseToken is required"),
  productId: z.enum(
    [
      // One-time coin purchases
      "coins_starter",
      "coins_regular",
      "coins_big",
      "coins_baller",
      "coins_boss",
      "coins_legend",
      // Monthly subscription plans
      "sub_plus_monthly",
      "sub_pro_monthly",
      "sub_max_monthly",
      // Annual subscription plans
      "sub_plus_annual",
      "sub_pro_annual",
      "sub_max_annual",
    ],
    { errorMap: () => ({ message: "Unknown productId" }) }
  ),
  packageName: z.string().min(1, "packageName is required"),
  /** Set to true when productId is a subscription (not a one-time purchase). */
  isSubscription: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// Google Play authentication helpers
// ---------------------------------------------------------------------------

interface ServiceAccountJson {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/**
 * Create a signed JWT for the Google service account.
 * Uses the RS256 algorithm as required by Google APIs.
 */
async function createServiceAccountJwt(sa: ServiceAccountJson): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

  const signingInput = `${encode(header)}.${encode(payload)}`;

  // Import private key for signing
  const privateKeyPem = sa.private_key.replace(/\\n/g, "\n");
  const keyData = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");

  const binaryKey = Buffer.from(keyData, "base64");

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    Buffer.from(signingInput)
  );

  const signatureB64 = Buffer.from(signature).toString("base64url");
  return `${signingInput}.${signatureB64}`;
}

// Module-level cache for the Google OAuth2 access token — avoids signing a new
// JWT on every request. Token is valid for 3600s; we refresh 60s early.
let _oauthCache: { token: string; expiresAt: number } | null = null;

/**
 * Exchange a service account JWT for an OAuth2 access token.
 * Results are cached at module scope for the lifetime of the token.
 */
async function getGoogleAccessToken(sa: ServiceAccountJson): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_oauthCache && _oauthCache.expiresAt > now + 60) {
    return _oauthCache.token;
  }

  const jwt = await createServiceAccountJwt(sa);
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let resp: Response;
  try {
    resp = await fetch(tokenUri, {
      signal: controller.signal,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw internalError(`Failed to get Google access token: ${text}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in?: number };
  const expiresIn = data.expires_in ?? 3600;
  _oauthCache = { token: data.access_token, expiresAt: now + expiresIn - 60 };
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Google Play Developer API calls
// ---------------------------------------------------------------------------

interface GooglePlayPurchase {
  purchaseState: number;   // 0 = purchased, 1 = cancelled, 2 = pending
  consumptionState: number; // 0 = not consumed, 1 = consumed
  acknowledgementState: number; // 0 = not acknowledged, 1 = acknowledged
  orderId: string;
}

/**
 * Verify a product purchase with the Google Play Developer API.
 * Falls back to "trusted" mode in development if env var not set.
 */
async function verifyGooglePlayPurchase(
  packageName: string,
  productId: string,
  purchaseToken: string
): Promise<GooglePlayPurchase> {
  const saJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;

  if (!saJson) {
    if (process.env.NODE_ENV === "production") {
      throw internalError(
        "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not configured. IAP verification is disabled."
      );
    }
    // Dev/test mode only — trust the purchase without verifying with Google
    console.warn(
      "[iap/verify] GOOGLE_PLAY_SERVICE_ACCOUNT_JSON not set — running in trusted dev mode. " +
        "DO NOT use this in production."
    );
    return {
      purchaseState: 0,
      consumptionState: 0,
      acknowledgementState: 0,
      orderId: `dev_order_${Date.now()}`,
    };
  }

  const sa: ServiceAccountJson = JSON.parse(saJson);
  const accessToken = await getGoogleAccessToken(sa);

  const url = `${GOOGLE_PLAY_API_BASE}/${packageName}/purchases/products/${productId}/tokens/${purchaseToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let resp: Response;
  try {
    resp = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw badRequest(`Google Play verification failed: ${text}`, "PLAY_VERIFY_FAILED");
  }

  return (await resp.json()) as GooglePlayPurchase;
}

/**
 * Consume a one-time product purchase on Google Play.
 *
 * Consumable products (coin packs) must use the :consume endpoint — not
 * :acknowledge. Using :acknowledge on a consumable leaves the purchase in a
 * non-consumed state and prevents the user from buying the same product again
 * until Google auto-cancels it.
 */
async function consumeGooglePlayPurchase(
  packageName: string,
  productId: string,
  purchaseToken: string
): Promise<void> {
  const saJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    console.warn("[iap/verify] Skipping Google Play consume in dev mode");
    return;
  }

  const sa: ServiceAccountJson = JSON.parse(saJson);
  const accessToken = await getGoogleAccessToken(sa);

  const url = `${GOOGLE_PLAY_API_BASE}/${packageName}/purchases/products/${productId}/tokens/${purchaseToken}:consume`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let resp: Response;
  try {
    resp = await fetch(url, {
      signal: controller.signal,
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok && resp.status !== 204) {
    // Non-fatal: log but don't fail the credit — coins were already granted
    const text = await resp.text();
    console.error(`[iap/verify] Failed to consume purchase: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// POST /api/economy/iap/verify
// ---------------------------------------------------------------------------

/**
 * Verify a Google Play subscription purchase and activate the user's plan.
 *
 * Uses the purchases.subscriptions API (not purchases.products) for subscriptions.
 * Idempotent via coin_ledger reference_id keyed on purchaseToken.
 */
async function verifyAndActivateSubscription(
  userId: string,
  packageName: string,
  productId: string,
  purchaseToken: string
): Promise<{ plan: string; coinsGranted: number }> {
  const subConfig = SUBSCRIPTION_PRODUCTS[productId];
  if (!subConfig) throw badRequest(`Unknown subscription productId: ${productId}`);

  const referenceId = `iap:sub:${purchaseToken}`;

  // Idempotency check
  const { rows: existing } = await db.query<{ id: string }>(
    `SELECT id FROM coin_ledger WHERE reference_id = $1 LIMIT 1`,
    [referenceId]
  );
  if (existing.length > 0) {
    // Already processed — return current plan state
    const { rows: u } = await db.query<{ plan: string }>(
      `SELECT COALESCE(plan, 'free') AS plan FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    return { plan: u[0]?.plan ?? subConfig.plan, coinsGranted: 0 };
  }

  // Verify with Google Play subscriptions API (different endpoint from products)
  const saJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    const sa: ServiceAccountJson = JSON.parse(saJson);
    const accessToken = await getGoogleAccessToken(sa);
    const url = `${GOOGLE_PLAY_API_BASE}/${packageName}/purchases/subscriptions/${productId}/tokens/${purchaseToken}`;
    const verifyCtrl = new AbortController();
    const verifyTimer = setTimeout(() => verifyCtrl.abort(), 5000);
    let resp: Response;
    try {
      resp = await fetch(url, { signal: verifyCtrl.signal, headers: { Authorization: `Bearer ${accessToken}` } });
    } finally {
      clearTimeout(verifyTimer);
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw badRequest(`Google Play subscription verification failed: ${text}`, "PLAY_VERIFY_FAILED");
    }
    const data = (await resp.json()) as { paymentState?: number; cancelReason?: number };
    // paymentState: 1 = payment received, 2 = free trial. cancelReason defined means cancelled.
    if (data.paymentState !== 1 && data.paymentState !== 2) {
      throw badRequest("Subscription payment not confirmed", "SUBSCRIPTION_NOT_PAID");
    }
    // Acknowledge to prevent auto-cancellation after 3 days
    const ackUrl = `${GOOGLE_PLAY_API_BASE}/${packageName}/purchases/subscriptions/${productId}/tokens/${purchaseToken}:acknowledge`;
    const ackCtrl = new AbortController();
    const ackTimer = setTimeout(() => ackCtrl.abort(), 5000);
    fetch(ackUrl, {
      signal: ackCtrl.signal,
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: "{}",
    }).catch((e) => console.error("[iap/verify] Subscription ack failed:", e)).finally(() => clearTimeout(ackTimer));
  } else {
    if (process.env.NODE_ENV === "production") {
      throw internalError(
        "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not configured. Subscription verification is disabled."
      );
    }
    console.warn("[iap/verify] GOOGLE_PLAY_SERVICE_ACCOUNT_JSON not set — trusting subscription in dev mode");
  }

  // Activate plan and credit monthly coin bonus atomically (BUG-FIN-17: single transaction)
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE users SET plan = $1, plan_activated_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [subConfig.plan, userId]
    );

    // Credit the monthly coin bonus only when the configured amount is positive —
    // a 0-coin bonus config would insert a no-op ledger row and wastes a write.
    if (subConfig.monthlyCoins > 0) {
      await creditCoins(
        userId,
        subConfig.monthlyCoins,
        "subscription_bonus",
        referenceId,
        `Google Play subscription: ${productId} — monthly coin bonus`,
        { productId, packageName, purchaseToken },
        tx
      );
    }
  });

  return { plan: subConfig.plan, coinsGranted: subConfig.monthlyCoins };
}

// ---------------------------------------------------------------------------
// POST /api/economy/iap/verify
// ---------------------------------------------------------------------------

/**
 * Verify a Google Play purchase and credit coins, or activate a subscription plan.
 *
 * Handles both one-time coin purchases and recurring subscription products.
 * Idempotent: returns 409 if the purchaseToken has already been processed.
 * Uses SELECT FOR UPDATE to prevent race conditions on the user row.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const body = await validateBody(req, verifyIapSchema);
    const userId = auth.user.sub;

    // Rate-limit per user to prevent purchase-token replay flooding.
    await enforceRateLimit(userId, "user", RATE_LIMITS.coinPurchase);

    // Route to subscription handler when productId is a subscription product
    const isSubscription = body.isSubscription || !!SUBSCRIPTION_PRODUCTS[body.productId];
    if (isSubscription) {
      const result = await verifyAndActivateSubscription(
        userId,
        body.packageName,
        body.productId,
        body.purchaseToken
      );
      return NextResponse.json(
        { success: true, coinsGranted: result.coinsGranted, plan: result.plan },
        { status: 200 }
      );
    }

    // --- One-time coin purchase flow ---
    const coinsToGrant = COIN_PRODUCTS[body.productId];
    if (!coinsToGrant) {
      throw badRequest(`Unknown productId: ${body.productId}`, "UNKNOWN_PRODUCT");
    }

    // Use a reference key that encodes the purchaseToken for idempotency lookup
    const referenceId = `iap:${body.purchaseToken}`;

    // 1. Verify the purchase with Google Play Developer API
    const purchase = await verifyGooglePlayPurchase(
      body.packageName,
      body.productId,
      body.purchaseToken
    );

    // purchaseState: 0 = purchased (valid), anything else = not valid
    if (purchase.purchaseState !== 0) {
      throw badRequest(
        `Purchase is not in a valid state (state=${purchase.purchaseState})`,
        "PURCHASE_INVALID"
      );
    }

    // consumptionState: 0 = not yet consumed. A token that's already consumed
    // means a prior request already processed it — treat as duplicate.
    if (purchase.consumptionState !== 0) {
      throw conflict("This purchase has already been consumed", "PURCHASE_ALREADY_PROCESSED");
    }

    // 2. Credit coins atomically — coin_ledger has a unique index on reference_id
    //    which prevents double-credit even under concurrent requests.
    //    Catch 23505 (unique_violation) and surface it as a 409 conflict.
    try {
      await creditCoins(
        userId,
        coinsToGrant,
        "iap_purchase",
        referenceId,
        `Google Play IAP: ${body.productId}`,
        {
          productId: body.productId,
          packageName: body.packageName,
          purchaseToken: body.purchaseToken,
          orderId: purchase.orderId,
        }
      );
    } catch (creditErr) {
      const pgCode = (creditErr as { code?: string })?.code;
      if (pgCode === "23505") {
        throw conflict("This purchase has already been processed", "PURCHASE_ALREADY_PROCESSED");
      }
      throw creditErr;
    }

    // 4. Consume the purchase on Google Play so the user can buy the pack again.
    //    Done after crediting so coins are never lost if the consume call fails.
    await consumeGooglePlayPurchase(
      body.packageName,
      body.productId,
      body.purchaseToken
    );

    return NextResponse.json(
      { success: true, coinsGranted: coinsToGrant },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
