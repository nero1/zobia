/**
 * apps/android/src/lib/payments/googlePlay.ts
 *
 * Google Play Billing — the *only* in-app purchase mechanism allowed on
 * Android (PRD §18; Paystack/DodoPayments are web/PWA-only). Covers coin
 * packs, star packs, Plus/Pro/Max subscriptions, and Business Account
 * tiers (the Android equivalent of the Paystack/DodoPayments checkout used
 * by apps/web/app/(app)/business and settings/business).
 *
 * Uses capacitor-plugin-cdv-purchase (a native Capacitor plugin — no Cordova
 * bridge, no WebView) instead of react-native-iap (RN-only, used by the
 * discontinued Expo app at apps/expo/lib/payments/googlePlay.ts, which this
 * mirrors for product catalogue/session/timeout conventions).
 *
 * Purchase flow:
 *  1. purchaseCoins() / purchaseStars() / purchaseSubscription() /
 *     purchaseBusinessTier() triggers the Google Play billing sheet.
 *  2. The global `store.when().approved()` listener receives the transaction
 *     and calls the matching server verification endpoint.
 *  3. The server verifies with the Google Play Developer API and credits
 *     coins/stars, activates the subscription plan, or creates/upgrades the
 *     Business Account.
 *  4. transaction.finish() is called ONLY after confirmed server credit —
 *     if verification fails, the transaction is left unfinished so Google
 *     Play replays it (to this listener, even across app restarts) instead
 *     of silently dropping the purchase.
 */

import { store, ProductType, Platform, ErrorCode, type Offer, type Transaction, type IError } from 'capacitor-plugin-cdv-purchase';
import { apiClient } from '@/lib/api/client';

/** Must match apps/android/android/app/build.gradle `applicationId`. */
const APP_PACKAGE_NAME = 'com.zobiasocial.app';

// ---------------------------------------------------------------------------
// Product catalogue — IDs/amounts must stay in sync with
// apps/web/app/api/economy/iap/verify/route.ts and
// apps/web/app/api/business/iap/verify/route.ts.
// ---------------------------------------------------------------------------

export interface CoinProduct {
  id: string;
  coins: number;
  price: string;
  title?: string;
}

export const COIN_PRODUCTS: CoinProduct[] = [
  { id: 'coins_starter', coins: 100,   price: '₦200' },
  { id: 'coins_regular', coins: 350,   price: '₦500' },
  { id: 'coins_big',     coins: 800,   price: '₦1,000' },
  { id: 'coins_baller',  coins: 1800,  price: '₦2,000' },
  { id: 'coins_boss',    coins: 5000,  price: '₦5,000' },
  { id: 'coins_legend',  coins: 11500, price: '₦10,000' },
];

export interface StarProduct {
  id: string;
  stars: number;
  price: string;
  title?: string;
}

export const STAR_PRODUCTS: StarProduct[] = [
  { id: 'stars_starter', stars: 10,  price: '₦500' },
  { id: 'stars_regular', stars: 30,  price: '₦1,200' },
  { id: 'stars_big',     stars: 80,  price: '₦2,500' },
  { id: 'stars_boss',    stars: 200, price: '₦5,000' },
];

export interface SubscriptionProduct {
  id: string;
  plan: 'plus' | 'pro' | 'max';
  label: string;
  monthlyPrice: string;
  monthlyCoins: number;
}

export const SUBSCRIPTION_PRODUCTS: SubscriptionProduct[] = [
  { id: 'sub_plus_monthly', plan: 'plus', label: 'Plus', monthlyPrice: '₦500',   monthlyCoins: 50 },
  { id: 'sub_pro_monthly',  plan: 'pro',  label: 'Pro',  monthlyPrice: '₦1,500', monthlyCoins: 200 },
  { id: 'sub_max_monthly',  plan: 'max',  label: 'Max',  monthlyPrice: '₦3,500', monthlyCoins: 500 },
];

export const ANNUAL_SUBSCRIPTION_PRODUCTS: SubscriptionProduct[] = [
  { id: 'sub_plus_annual', plan: 'plus', label: 'Plus (Annual)', monthlyPrice: '₦5,000',  monthlyCoins: 50 },
  { id: 'sub_pro_annual',  plan: 'pro',  label: 'Pro (Annual)',  monthlyPrice: '₦15,000', monthlyCoins: 200 },
  { id: 'sub_max_annual',  plan: 'max',  label: 'Max (Annual)',  monthlyPrice: '₦35,000', monthlyCoins: 500 },
];

export interface BusinessTierProduct {
  id: string;
  tier: 'starter' | 'growth' | 'enterprise';
  label: string;
  price: string;
}

export const BUSINESS_TIER_PRODUCTS: BusinessTierProduct[] = [
  { id: 'biz_starter_monthly',    tier: 'starter',    label: 'Starter',    price: '₦5,000/mo' },
  { id: 'biz_growth_monthly',     tier: 'growth',      label: 'Growth',     price: '₦15,000/mo' },
  { id: 'biz_enterprise_monthly', tier: 'enterprise',  label: 'Enterprise', price: '₦50,000+/mo' },
];

const CONSUMABLE_IDS = [...COIN_PRODUCTS.map((p) => p.id), ...STAR_PRODUCTS.map((p) => p.id)];
const SUBSCRIPTION_IDS = [...SUBSCRIPTION_PRODUCTS.map((p) => p.id), ...ANNUAL_SUBSCRIPTION_PRODUCTS.map((p) => p.id)];
const BUSINESS_IDS = BUSINESS_TIER_PRODUCTS.map((p) => p.id);

function isBusinessProductId(productId: string): boolean {
  return BUSINESS_IDS.includes(productId);
}
function isSubscriptionProductId(productId: string): boolean {
  return SUBSCRIPTION_IDS.includes(productId);
}

// ---------------------------------------------------------------------------
// Server verification
// ---------------------------------------------------------------------------

interface EconomyVerifyResult {
  coinsGranted: number;
  starsGranted?: number;
  plan?: string;
}

async function verifyEconomyPurchase(
  purchaseToken: string,
  productId: string,
  isSubscription: boolean
): Promise<EconomyVerifyResult | null> {
  try {
    const { data } = await apiClient.post<{ success: boolean; coinsGranted: number; starsGranted?: number; plan?: string }>(
      '/economy/iap/verify',
      { purchaseToken, productId, packageName: APP_PACKAGE_NAME, isSubscription }
    );
    if (!data.success) return null;
    return { coinsGranted: data.coinsGranted, starsGranted: data.starsGranted, plan: data.plan };
  } catch (err) {
    console.error('[googlePlay] economy purchase verification failed:', err);
    return null;
  }
}

interface BusinessVerifyResult {
  tier: string;
}

/** Set by purchaseBusinessTier() so the global listener has the signup details when it fires. */
const pendingBusinessSignup = new Map<string, { businessName?: string; businessType?: string }>();

async function verifyBusinessPurchase(purchaseToken: string, productId: string): Promise<BusinessVerifyResult | null> {
  try {
    const signupInfo = pendingBusinessSignup.get(productId);
    const { data } = await apiClient.post<{ success: boolean; tier: string }>('/business/iap/verify', {
      purchaseToken,
      productId,
      packageName: APP_PACKAGE_NAME,
      business_name: signupInfo?.businessName,
      business_type: signupInfo?.businessType,
    });
    if (!data.success) return null;
    return { tier: data.tier };
  } catch (err) {
    console.error('[googlePlay] business purchase verification failed:', err);
    return null;
  } finally {
    pendingBusinessSignup.delete(productId);
  }
}

/** Extract the raw Google Play purchase token — only present on the GooglePlay.Receipt subtype. */
function extractPurchaseToken(transaction: Transaction): string | undefined {
  const receipt = transaction.parentReceipt as unknown as { purchaseToken?: string } | undefined;
  return receipt?.purchaseToken;
}

// ---------------------------------------------------------------------------
// Global purchase resolver map — one in-flight purchase per productId
// ---------------------------------------------------------------------------

type PurchaseOutcome =
  | { status: 'success'; coinsGranted?: number; starsGranted?: number; plan?: string; tier?: string }
  | { status: 'failed'; error: string };

type PurchaseResolver = (outcome: PurchaseOutcome) => void;
const purchaseResolvers = new Map<string, PurchaseResolver>();

const VERIFY_FAILED_MESSAGE = 'Server verification failed — please contact support if your purchase is missing.';

function setupGlobalPurchaseListeners(): void {
  store.when().approved(async (transaction: Transaction) => {
    const productId = transaction.products[0]?.id;
    if (!productId) return;

    const purchaseToken = extractPurchaseToken(transaction);
    const resolver = purchaseResolvers.get(productId);
    purchaseResolvers.delete(productId);

    if (!purchaseToken) {
      resolver?.({ status: 'failed', error: 'Missing purchase token' });
      return;
    }

    // BUG-05 pattern (mirrors apps/expo/lib/payments/googlePlay.ts): verify
    // server-side FIRST; only finish() the transaction on confirmed credit,
    // so a failed verification lets Google Play replay this listener later
    // (including across app restarts) instead of losing the purchase.
    if (isBusinessProductId(productId)) {
      const result = await verifyBusinessPurchase(purchaseToken, productId);
      if (result !== null) {
        await transaction.finish().catch(() => {});
        resolver?.({ status: 'success', tier: result.tier });
      } else {
        resolver?.({ status: 'failed', error: VERIFY_FAILED_MESSAGE });
      }
      return;
    }

    const result = await verifyEconomyPurchase(purchaseToken, productId, isSubscriptionProductId(productId));
    if (result !== null) {
      await transaction.finish().catch(() => {});
      resolver?.({ status: 'success', coinsGranted: result.coinsGranted, starsGranted: result.starsGranted, plan: result.plan });
    } else {
      resolver?.({ status: 'failed', error: VERIFY_FAILED_MESSAGE });
    }
  });

  store.error((error: IError) => {
    if (!error.productId) return;
    const resolver = purchaseResolvers.get(error.productId);
    if (!resolver) return;
    purchaseResolvers.delete(error.productId);
    resolver({ status: 'failed', error: error.message || 'Purchase failed' });
  });
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

let initialized = false;
let initPromise: Promise<void> | null = null;

/** Connect to Google Play Billing and register the product catalogue. Call once at app startup. */
export async function initGooglePlayBilling(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      store.register([
        ...CONSUMABLE_IDS.map((id) => ({ id, type: ProductType.CONSUMABLE, platform: Platform.GOOGLE_PLAY })),
        ...SUBSCRIPTION_IDS.map((id) => ({ id, type: ProductType.PAID_SUBSCRIPTION, platform: Platform.GOOGLE_PLAY })),
        // `group: 'business_tier'` tells Play Billing these three subscriptions
        // are mutually exclusive tiers of the same product — purchasing one
        // replaces any currently-owned one instead of stacking subscriptions.
        ...BUSINESS_IDS.map((id) => ({ id, type: ProductType.PAID_SUBSCRIPTION, platform: Platform.GOOGLE_PLAY, group: 'business_tier' })),
      ]);
      setupGlobalPurchaseListeners();
      await store.initialize([Platform.GOOGLE_PLAY]);
      initialized = true;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

// ---------------------------------------------------------------------------
// Purchase flow
// ---------------------------------------------------------------------------

const PURCHASE_TIMEOUT_MS = 5 * 60 * 1000;

function getOffer(productId: string): Offer | undefined {
  return store.get(productId, Platform.GOOGLE_PLAY)?.getOffer();
}

/**
 * Place an order for the given product and wait for server-verified credit.
 *
 * If the client-side timeout fires, the purchase may still complete in the
 * background — the global listener will verify and finish it (and grant the
 * reward) whenever Google Play reports it, with or without a waiting caller.
 */
async function orderAndAwait(productId: string, timeoutMessage: string): Promise<PurchaseOutcome> {
  if (purchaseResolvers.has(productId)) {
    return { status: 'failed', error: 'A purchase is already in progress for this product' };
  }

  const offer = getOffer(productId);
  if (!offer) {
    return { status: 'failed', error: 'This product is unavailable right now — please try again shortly' };
  }

  const purchasePromise = new Promise<PurchaseOutcome>((resolve) => {
    purchaseResolvers.set(productId, resolve);
  });

  const orderError = await store.order(offer).catch((err: unknown): IError => ({
    isError: true,
    code: ErrorCode.PURCHASE,
    message: err instanceof Error ? err.message : 'Purchase failed',
    platform: Platform.GOOGLE_PLAY,
    productId,
  }));
  if (orderError) {
    purchaseResolvers.delete(productId);
    return { status: 'failed', error: orderError.message || 'Purchase failed' };
  }

  const timeoutPromise = new Promise<PurchaseOutcome>((resolve) => {
    setTimeout(() => {
      // Leave the transaction to the global listener — don't delete the
      // resolver's registration here; it already resolved via race() below.
      resolve({ status: 'failed', error: timeoutMessage });
    }, PURCHASE_TIMEOUT_MS);
  });

  return Promise.race([purchasePromise, timeoutPromise]);
}

export async function purchaseCoins(productId: string): Promise<{ success: boolean; coins: number; error?: string }> {
  const product = COIN_PRODUCTS.find((p) => p.id === productId);
  if (!product) return { success: false, coins: 0, error: 'Unknown product ID' };

  const outcome = await orderAndAwait(productId, 'Your purchase is still processing — please wait before trying again');
  if (outcome.status === 'success') return { success: true, coins: outcome.coinsGranted ?? product.coins };
  return { success: false, coins: 0, error: outcome.error };
}

export async function purchaseStars(productId: string): Promise<{ success: boolean; stars: number; error?: string }> {
  const product = STAR_PRODUCTS.find((p) => p.id === productId);
  if (!product) return { success: false, stars: 0, error: 'Unknown product ID' };

  const outcome = await orderAndAwait(productId, 'Your purchase is still processing — please wait before trying again');
  if (outcome.status === 'success') return { success: true, stars: outcome.starsGranted ?? product.stars };
  return { success: false, stars: 0, error: outcome.error };
}

export async function purchaseSubscription(productId: string): Promise<{ success: boolean; plan?: string; error?: string }> {
  const product = SUBSCRIPTION_PRODUCTS.find((p) => p.id === productId) ?? ANNUAL_SUBSCRIPTION_PRODUCTS.find((p) => p.id === productId);
  if (!product) return { success: false, error: 'Unknown subscription product ID' };

  const outcome = await orderAndAwait(productId, 'Your purchase is still processing — please wait before trying again');
  if (outcome.status === 'success') return { success: true, plan: outcome.plan ?? product.plan };
  return { success: false, error: outcome.error };
}

/**
 * Purchase (or change) a Business Account tier. `businessName`/`businessType`
 * are required the first time (account creation) — pass them again on
 * upgrades and they'll simply be ignored server-side.
 */
export async function purchaseBusinessTier(
  productId: string,
  businessName?: string,
  businessType?: string
): Promise<{ success: boolean; tier?: string; error?: string }> {
  const product = BUSINESS_TIER_PRODUCTS.find((p) => p.id === productId);
  if (!product) return { success: false, error: 'Unknown business tier product ID' };

  pendingBusinessSignup.set(productId, { businessName, businessType });
  const outcome = await orderAndAwait(productId, 'Your purchase is still processing — please wait before trying again');
  if (outcome.status === 'success') return { success: true, tier: outcome.tier ?? product.tier };
  return { success: false, error: outcome.error };
}

/** Re-verify all available device purchases server-side (e.g. after reinstall). */
export async function restorePurchases(): Promise<{ error?: string }> {
  const result = await store.restorePurchases();
  return { error: result?.message };
}
