/**
 * lib/payments/googlePlayVerify.ts
 *
 * Shared Google Play Developer API helpers — server-side verification of
 * purchases made via Google Play Billing on the Capacitor Android app
 * (apps/android/src/lib/payments/googlePlay.ts) and, historically, the
 * now-discontinued Expo app.
 *
 * Extracted from app/api/economy/iap/verify/route.ts so the coin/star/
 * subscription IAP route and app/api/business/iap/verify/route.ts (Business
 * Account signup/upgrade via Play Billing, PRD §18) share one implementation
 * of the JWT signing / OAuth / purchases.products / purchases.subscriptions
 * calls instead of duplicating them.
 */

import { badRequest, internalError } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { getGoogleServiceAccountAccessToken, type GoogleServiceAccountJson } from "@/lib/google/serviceAccountAuth";

const GOOGLE_PLAY_API_BASE =
  "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";

const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

/**
 * Expected Android package name — rejects purchase tokens from other Google
 * Play apps. Defaults to the Capacitor app's applicationId (apps/android/android/app/build.gradle);
 * the Expo app is discontinued and no longer published.
 */
export const EXPECTED_PACKAGE_NAME =
  process.env.GOOGLE_PLAY_PACKAGE_NAME ?? "com.zobiasocial.app";

function loadServiceAccount(): GoogleServiceAccountJson | null {
  const saJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!saJson) return null;
  return JSON.parse(saJson) as GoogleServiceAccountJson;
}

async function getGoogleAccessToken(sa: GoogleServiceAccountJson): Promise<string> {
  try {
    return await getGoogleServiceAccountAccessToken(sa, ANDROID_PUBLISHER_SCOPE);
  } catch (err) {
    throw internalError(`Failed to get Google access token: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// purchases.products (one-time consumables — coin packs, star packs)
// ---------------------------------------------------------------------------

export interface GooglePlayProductPurchase {
  purchaseState: number; // 0 = purchased, 1 = cancelled, 2 = pending
  consumptionState: number; // 0 = not consumed, 1 = consumed
  acknowledgementState: number; // 0 = not acknowledged, 1 = acknowledged
  orderId: string;
}

/**
 * Verify a one-time product purchase with the Google Play Developer API.
 * Falls back to "trusted" mode in development if the service account isn't set.
 */
export async function verifyGooglePlayProductPurchase(
  packageName: string,
  productId: string,
  purchaseToken: string
): Promise<GooglePlayProductPurchase> {
  const sa = loadServiceAccount();

  if (!sa) {
    if (process.env.NODE_ENV === "production") {
      throw internalError(
        "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not configured. IAP verification is disabled."
      );
    }
    logger.warn("[googlePlayVerify] GOOGLE_PLAY_SERVICE_ACCOUNT_JSON not set — running in trusted dev mode. DO NOT use this in production.");
    return {
      purchaseState: 0,
      consumptionState: 0,
      acknowledgementState: 0,
      orderId: `dev_order_${Date.now()}`,
    };
  }

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

  return (await resp.json()) as GooglePlayProductPurchase;
}

/**
 * Consume a one-time product purchase on Google Play.
 *
 * Consumable products (coin/star packs) must use the :consume endpoint — not
 * :acknowledge. Using :acknowledge on a consumable leaves the purchase in a
 * non-consumed state and prevents the user from buying the same product again
 * until Google auto-cancels it.
 */
export async function consumeGooglePlayPurchase(
  packageName: string,
  productId: string,
  purchaseToken: string
): Promise<void> {
  const sa = loadServiceAccount();
  if (!sa) {
    logger.warn("[googlePlayVerify] Skipping Google Play consume in dev mode");
    return;
  }

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
    // Non-fatal: log but don't fail the credit — the reward was already granted.
    const text = await resp.text();
    logger.error(`[googlePlayVerify] Failed to consume purchase: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// purchases.subscriptions (recurring — Plus/Pro/Max plans, Business tiers)
// ---------------------------------------------------------------------------

export interface GooglePlaySubscriptionPurchase {
  paymentState?: number; // 1 = payment received, 2 = free trial
  cancelReason?: number;
}

/**
 * Verify a subscription purchase with the Google Play subscriptions API
 * (a different endpoint from one-time products). Falls back to "trusted"
 * mode in development if the service account isn't set.
 */
export async function verifyGooglePlaySubscriptionPurchase(
  packageName: string,
  productId: string,
  purchaseToken: string
): Promise<GooglePlaySubscriptionPurchase> {
  const sa = loadServiceAccount();
  if (!sa) {
    if (process.env.NODE_ENV === "production") {
      throw internalError(
        "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not configured. Subscription verification is disabled."
      );
    }
    logger.warn("[googlePlayVerify] GOOGLE_PLAY_SERVICE_ACCOUNT_JSON not set — trusting subscription in dev mode");
    return { paymentState: 1 };
  }

  const accessToken = await getGoogleAccessToken(sa);
  const url = `${GOOGLE_PLAY_API_BASE}/${packageName}/purchases/subscriptions/${productId}/tokens/${purchaseToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let resp: Response;
  try {
    resp = await fetch(url, { signal: controller.signal, headers: { Authorization: `Bearer ${accessToken}` } });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw badRequest(`Google Play subscription verification failed: ${text}`, "PLAY_VERIFY_FAILED");
  }

  return (await resp.json()) as GooglePlaySubscriptionPurchase;
}

/**
 * Acknowledge a subscription purchase — required within 3 days of purchase
 * or Google Play auto-refunds and cancels it. Non-fatal on failure (logged).
 */
export async function acknowledgeGooglePlaySubscription(
  packageName: string,
  productId: string,
  purchaseToken: string
): Promise<void> {
  const sa = loadServiceAccount();
  if (!sa) return;

  const accessToken = await getGoogleAccessToken(sa);
  const url = `${GOOGLE_PLAY_API_BASE}/${packageName}/purchases/subscriptions/${productId}/tokens/${purchaseToken}:acknowledge`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!resp.ok) logger.error({ status: resp.status }, "[googlePlayVerify] Subscription ack failed");
  } catch (e) {
    logger.error({ err: e }, "[googlePlayVerify] Subscription ack error:");
  } finally {
    clearTimeout(timer);
  }
}
