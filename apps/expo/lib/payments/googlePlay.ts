/**
 * lib/payments/googlePlay.ts
 *
 * Google Play Billing integration (Android only).
 * Uses react-native-iap for coin top-ups and subscription plans.
 *
 * NOTE: This used to use expo-in-app-purchases, which is deprecated and no
 * longer compiles on Expo SDK 51 (its native module targets the removed
 * legacy `ExportedModule`/`@ExpoMethod` unimodules API). react-native-iap is
 * the maintained replacement and links against modern Play Billing (v6/v7).
 *
 * Product IDs must be created in the Google Play Console.
 * Matching coin amounts are defined below.
 *
 * Purchase flow (coins):
 *  1. purchaseCoins() triggers the Google Play billing sheet
 *  2. The global listener receives the purchase and calls verifyPurchaseServerSide
 *  3. Server verifies with Google Play Developer API and credits coins
 *  4. finishTransaction({ isConsumable: true }) is called ONLY after confirmed server credit
 *
 * Purchase flow (subscriptions):
 *  1. purchaseSubscription() triggers the Google Play billing sheet
 *  2. The global listener receives the purchase and calls verifyPurchaseServerSide
 *  3. Server verifies with Google Play subscriptions API and activates plan
 *  4. finishTransaction({ isConsumable: false }) acknowledges ONLY after server credit
 */

import { Platform, type EmitterSubscription } from 'react-native';
import {
  initConnection,
  endConnection,
  getProducts,
  getSubscriptions,
  requestPurchase,
  requestSubscription,
  finishTransaction,
  flushFailedPurchasesCachedAsPendingAndroid,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type Product,
  type Subscription,
  type Purchase,
  type PurchaseError,
} from 'react-native-iap';
import { apiClient } from '@/lib/api/client';
import { randomUUID } from 'expo-crypto';

const APP_PACKAGE_NAME = 'org.zobia.social';

type AnyPurchase = Purchase;

// ---------------------------------------------------------------------------
// Product catalogue
// ---------------------------------------------------------------------------

export interface CoinProduct {
  id: string;
  /** Server-side UUID for the coin pack (matches CoinPack.id from /economy/store). */
  productId?: string;
  price: string;
  coins: number;
  title?: string;
}

export interface SubscriptionProduct {
  id: string;
  plan: 'plus' | 'pro' | 'max';
  label: string;
  monthlyPrice: string;
  annualPrice: string;
  monthlyCoins: number;
}

/** Maps Play Store product IDs to coin amounts (base + bonus = total). */
export const COIN_PRODUCTS: CoinProduct[] = [
  { id: 'coins_starter', coins: 100,    price: '₦200' },   // 100 base, no bonus
  { id: 'coins_regular', coins: 350,    price: '₦500' },   // 300 base + 50 bonus
  { id: 'coins_big',     coins: 800,    price: '₦1,000' }, // 700 base + 100 bonus
  { id: 'coins_baller',  coins: 1800,   price: '₦2,000' }, // 1,600 base + 200 bonus
  { id: 'coins_boss',    coins: 5000,   price: '₦5,000' }, // 4,500 base + 500 bonus
  { id: 'coins_legend',  coins: 11500,  price: '₦10,000' },// 10,000 base + 1,500 bonus
];

/** Subscription plan products — must match PRD §3 prices. */
export const SUBSCRIPTION_PRODUCTS: SubscriptionProduct[] = [
  {
    id: 'sub_plus_monthly',
    plan: 'plus',
    label: 'Plus',
    monthlyPrice: '₦500',
    annualPrice: '₦5,000',
    monthlyCoins: 50,
  },
  {
    id: 'sub_pro_monthly',
    plan: 'pro',
    label: 'Pro',
    monthlyPrice: '₦1,500',
    annualPrice: '₦15,000',
    monthlyCoins: 200,
  },
  {
    id: 'sub_max_monthly',
    plan: 'max',
    label: 'Max',
    monthlyPrice: '₦3,500',
    annualPrice: '₦35,000',
    monthlyCoins: 500,
  },
];

/** Annual subscription products (2 months free vs monthly billing). */
export const ANNUAL_SUBSCRIPTION_PRODUCTS: SubscriptionProduct[] = [
  {
    id: 'sub_plus_annual',
    plan: 'plus',
    label: 'Plus (Annual)',
    monthlyPrice: '₦500',
    annualPrice: '₦5,000',
    monthlyCoins: 50,
  },
  {
    id: 'sub_pro_annual',
    plan: 'pro',
    label: 'Pro (Annual)',
    monthlyPrice: '₦1,500',
    annualPrice: '₦15,000',
    monthlyCoins: 200,
  },
  {
    id: 'sub_max_annual',
    plan: 'max',
    label: 'Max (Annual)',
    monthlyPrice: '₦3,500',
    annualPrice: '₦35,000',
    monthlyCoins: 500,
  },
];

const PRODUCT_IDS = COIN_PRODUCTS.map((p) => p.id);
const SUBSCRIPTION_IDS = [
  ...SUBSCRIPTION_PRODUCTS.map((p) => p.id),
  ...ANNUAL_SUBSCRIPTION_PRODUCTS.map((p) => p.id),
];

// ---------------------------------------------------------------------------
// react-native-iap helpers
// ---------------------------------------------------------------------------

/**
 * Android subscriptions are purchased against a specific *offer*, identified by
 * an offerToken returned in the product details. We cache the most recent token
 * per subscription product ID so purchaseSubscription() can pass it through.
 */
const subscriptionOfferTokens = new Map<string, string>();

/** Read the Android purchase token from a react-native-iap purchase object. */
function getPurchaseToken(purchase: AnyPurchase): string | undefined {
  // On Android this is `purchaseToken`; transactionReceipt is the JSON fallback.
  return purchase.purchaseToken ?? undefined;
}

/** Whether the purchase has already been acknowledged on the Play side. */
function isAcknowledged(purchase: AnyPurchase): boolean {
  return Boolean((purchase as { isAcknowledgedAndroid?: boolean }).isAcknowledgedAndroid);
}

/** Extract the recurring formatted price + offerToken from an Android subscription. */
function readAndroidSubscription(sub: Subscription): { price?: string; offerToken?: string } {
  const offers = (sub as { subscriptionOfferDetails?: Array<{
    offerToken?: string;
    pricingPhases?: { pricingPhaseList?: Array<{ formattedPrice?: string }> };
  }> }).subscriptionOfferDetails;

  if (Array.isArray(offers) && offers.length > 0) {
    const offer = offers[0];
    const phases = offer?.pricingPhases?.pricingPhaseList;
    // Use the last pricing phase — that's the ongoing recurring price after any
    // free-trial / introductory phases.
    const price =
      Array.isArray(phases) && phases.length > 0
        ? phases[phases.length - 1]?.formattedPrice
        : undefined;
    return { price, offerToken: offer?.offerToken };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Server verification
// ---------------------------------------------------------------------------

/**
 * Verify a completed Google Play purchase server-side and credit coins or activate plan.
 */
async function verifyPurchaseServerSide(
  purchaseToken: string,
  productId: string,
  packageName: string,
  isSubscription = false
): Promise<{ coinsGranted: number; plan?: string } | null> {
  try {
    const response = await apiClient.post<{
      success: boolean;
      coinsGranted: number;
      plan?: string;
    }>('/economy/iap/verify', {
      purchaseToken,
      productId,
      packageName,
      isSubscription,
    });
    if (response.data.success) {
      return { coinsGranted: response.data.coinsGranted, plan: response.data.plan };
    }
    return null;
  } catch (err) {
    console.error('[googlePlay] Server-side purchase verification failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Global purchase resolver map (BUG-10)
// ---------------------------------------------------------------------------

type PurchaseOutcome =
  | { status: 'success'; coinsGranted: number; plan?: string }
  | { status: 'failed'; error: string };

type PurchaseResolver = (outcome: PurchaseOutcome) => void;

/**
 * Maps sessionId → pending resolver. Each purchase gets a unique sessionId so
 * concurrent purchases of the same productId don't overwrite each other.
 */
const purchaseResolvers = new Map<string, PurchaseResolver>();

/**
 * Maps productId → active sessionId. Used by the listener to dispatch results
 * to the correct resolver when a purchase completes.
 */
const activePurchaseSessions = new Map<string, string>();

/**
 * Tracks productIds where the client-side timeout fired but the underlying
 * Google Play purchase may still complete asynchronously. Prevents users from
 * initiating a duplicate purchase while the original is still being recovered.
 * Cleared when the listener delivers the late result.
 */
const pendingRecovery = new Map<string, boolean>();

const VERIFY_FAILED_MESSAGE =
  'Server verification failed — please contact support if coins are missing';

// ---------------------------------------------------------------------------
// Global listeners
// ---------------------------------------------------------------------------

let purchaseUpdateSub: EmitterSubscription | null = null;
let purchaseErrorSub: EmitterSubscription | null = null;

/**
 * Register the single global purchase + error listeners.
 * Must be called once after initConnection() succeeds.
 */
function setupGlobalPurchaseListeners(): void {
  purchaseUpdateSub?.remove();
  purchaseErrorSub?.remove();

  purchaseUpdateSub = purchaseUpdatedListener(async (purchase: AnyPurchase) => {
    const productId = purchase.productId;
    const purchaseToken = getPurchaseToken(purchase);
    const isSubscription = SUBSCRIPTION_IDS.includes(productId);

    const sessionId = activePurchaseSessions.get(productId);
    if (!sessionId) {
      // No active session — this purchase is from a prior app session or a
      // timed-out purchase that is now recovering asynchronously. Clear the
      // pendingRecovery flag so the user can start a new purchase once this one
      // is finished.
      if (pendingRecovery.get(productId)) {
        pendingRecovery.delete(productId);
      }
      if (purchaseToken && !isAcknowledged(purchase)) {
        const result = await verifyPurchaseServerSide(
          purchaseToken,
          productId,
          APP_PACKAGE_NAME,
          isSubscription
        ).catch(() => null);
        if (result !== null) {
          try {
            await finishTransaction({ purchase, isConsumable: !isSubscription });
          } catch {}
        }
      }
      return;
    }

    const resolver = purchaseResolvers.get(sessionId);
    if (!resolver || !purchaseToken) return;

    // Remove before async work to prevent double-resolution.
    activePurchaseSessions.delete(productId);
    purchaseResolvers.delete(sessionId);

    // BUG-05: verify server-side FIRST; only consume/acknowledge on success.
    const verifyResult = await verifyPurchaseServerSide(
      purchaseToken,
      productId,
      APP_PACKAGE_NAME,
      isSubscription
    ).catch(() => null);

    if (verifyResult !== null) {
      // Only finish the transaction after confirmed server credit.
      try {
        await finishTransaction({ purchase, isConsumable: !isSubscription });
      } catch (finishErr) {
        console.warn('[googlePlay] finishTransaction failed:', finishErr);
      }
      resolver({
        status: 'success',
        coinsGranted: verifyResult.coinsGranted,
        plan: verifyResult.plan,
      });
    } else {
      // Do NOT finish the transaction so Play Store can replay it.
      resolver({ status: 'failed', error: VERIFY_FAILED_MESSAGE });
    }
  });

  purchaseErrorSub = purchaseErrorListener((error: PurchaseError) => {
    // react-native-iap surfaces user cancellation and billing failures here
    // (rather than rejecting requestPurchase). Resolve any waiting session.
    const productId = error.productId;
    if (!productId) return;
    const sessionId = activePurchaseSessions.get(productId);
    if (!sessionId) return;
    const resolver = purchaseResolvers.get(sessionId);
    activePurchaseSessions.delete(productId);
    purchaseResolvers.delete(sessionId);
    resolver?.({ status: 'failed', error: error.message || 'Purchase failed' });
  });
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

let initialised = false;

/**
 * Connect to Google Play Billing. Call once at app startup (Android only).
 */
export async function initGooglePlayBilling(): Promise<void> {
  if (Platform.OS !== 'android' || initialised) return;
  // Set flag before await to prevent a second concurrent call from also
  // entering initConnection while the first is still in flight (race window fix).
  initialised = true;
  try {
    await initConnection();
    // Recommended on Android: reconcile any purchases stuck in the pending
    // state from a previous run. Failure here is non-fatal.
    try {
      await flushFailedPurchasesCachedAsPendingAndroid();
    } catch {}
    setupGlobalPurchaseListeners();
  } catch (err) {
    // Reset so the caller can retry after a failed init attempt.
    initialised = false;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Product listing
// ---------------------------------------------------------------------------

/**
 * Fetch available coin products from the Play Store.
 *
 * @returns List of available products with prices from the store
 */
export async function getCoinProducts(): Promise<CoinProduct[]> {
  if (Platform.OS !== 'android') return [];

  try {
    const results: Product[] = await getProducts({ skus: PRODUCT_IDS });
    if (!results || results.length === 0) {
      return COIN_PRODUCTS;
    }

    return COIN_PRODUCTS.map((local) => {
      const store = results.find((r) => r.productId === local.id);
      return store
        ? { ...local, price: store.localizedPrice ?? local.price, title: store.title }
        : local;
    });
  } catch {
    return COIN_PRODUCTS;
  }
}

// ---------------------------------------------------------------------------
// Purchase flow
// ---------------------------------------------------------------------------

/**
 * Initiate a coin purchase via Google Play.
 *
 * Flow:
 *  1. Registers a resolver in the global purchaseResolvers map
 *  2. Opens the Google Play billing sheet for the given product
 *  3. Global listener receives the result, verifies server-side, then resolves
 *
 * @param productId - Play Store product ID (e.g. 'coins_starter')
 * @returns Purchase result with coins granted, or failure info
 */
export async function purchaseCoins(
  productId: string
): Promise<{
  success: boolean;
  coins: number;
  purchaseToken?: string;
  error?: string;
}> {
  if (Platform.OS !== 'android') {
    return { success: false, coins: 0, error: 'Android only' };
  }

  const product = COIN_PRODUCTS.find((p) => p.id === productId);
  if (!product) {
    return { success: false, coins: 0, error: 'Unknown product ID' };
  }

  // Prevent concurrent purchases of the same product overwriting the resolver map.
  // Also block new purchases while a previous timed-out purchase is still recovering.
  if (activePurchaseSessions.has(productId)) {
    return { success: false, coins: 0, error: 'A purchase is already in progress for this product' };
  }
  if (pendingRecovery.get(productId)) {
    return { success: false, coins: 0, error: 'A previous purchase is still being processed — please wait before trying again' };
  }

  const sessionId = randomUUID();
  const purchasePromise = new Promise<{ success: boolean; coins: number; purchaseToken?: string; error?: string }>((resolve) => {
    purchaseResolvers.set(sessionId, (outcome) => {
      if (outcome.status === 'success') {
        resolve({ success: true, coins: outcome.coinsGranted });
      } else {
        resolve({ success: false, coins: 0, error: outcome.error });
      }
    });
    activePurchaseSessions.set(productId, sessionId);

    requestPurchase({ skus: [productId] }).catch((err: unknown) => {
      // Errors usually arrive via purchaseErrorListener; this is a safety net.
      if (!purchaseResolvers.has(sessionId)) return;
      purchaseResolvers.delete(sessionId);
      activePurchaseSessions.delete(productId);
      resolve({ success: false, coins: 0, error: err instanceof Error ? err.message : 'Purchase failed' });
    });
  });

  // When the timeout fires the resolver is removed but the purchase continues
  // running in the background. Mark pendingRecovery so the listener can deliver
  // the late result and prevent the user from initiating a duplicate purchase.
  const timeoutPromise = new Promise<{ success: boolean; coins: number; error: string }>((resolve) =>
    setTimeout(() => {
      purchaseResolvers.delete(sessionId);
      activePurchaseSessions.delete(productId);
      pendingRecovery.set(productId, true);
      resolve({ success: false, coins: 0, error: 'Your purchase is still processing — please wait before trying again' });
    }, 5 * 60 * 1000)
  );

  return Promise.race([purchasePromise, timeoutPromise]);
}

/**
 * Disconnect from Google Play Billing. Call on app unmount.
 */
export async function disconnectGooglePlayBilling(): Promise<void> {
  if (Platform.OS !== 'android' || !initialised) return;
  purchaseUpdateSub?.remove();
  purchaseErrorSub?.remove();
  purchaseUpdateSub = null;
  purchaseErrorSub = null;
  await endConnection();
  initialised = false;
}

// ---------------------------------------------------------------------------
// Subscription purchase flow
// ---------------------------------------------------------------------------

/**
 * Fetch available subscription products from the Play Store.
 *
 * @param annual - When true, returns annual billing products instead of monthly.
 */
export async function getSubscriptionProducts(annual = false): Promise<SubscriptionProduct[]> {
  const localProducts = annual ? ANNUAL_SUBSCRIPTION_PRODUCTS : SUBSCRIPTION_PRODUCTS;
  if (Platform.OS !== 'android') return localProducts;

  try {
    const results: Subscription[] = await getSubscriptions({ skus: SUBSCRIPTION_IDS });
    if (!results || results.length === 0) {
      return localProducts;
    }

    return localProducts.map((local) => {
      const store = results.find((r) => r.productId === local.id);
      if (!store) return local;
      const { price, offerToken } = readAndroidSubscription(store);
      if (offerToken) subscriptionOfferTokens.set(local.id, offerToken);
      return price ? { ...local, monthlyPrice: price } : local;
    });
  } catch {
    return localProducts;
  }
}

/**
 * Initiate a subscription purchase via Google Play.
 *
 * Flow:
 *  1. Registers a resolver in the global purchaseResolvers map
 *  2. Opens the Google Play billing sheet for the subscription product
 *  3. Global listener receives the result, verifies server-side, then resolves
 *
 * @param productId - Subscription product ID (e.g. 'sub_plus_monthly')
 */
export async function purchaseSubscription(
  productId: string
): Promise<{
  success: boolean;
  plan?: string;
  coinsGranted?: number;
  purchaseToken?: string;
  error?: string;
}> {
  if (Platform.OS !== 'android') {
    return { success: false, error: 'Android only' };
  }

  const product =
    SUBSCRIPTION_PRODUCTS.find((p) => p.id === productId) ??
    ANNUAL_SUBSCRIPTION_PRODUCTS.find((p) => p.id === productId);
  if (!product) {
    return { success: false, error: 'Unknown subscription product ID' };
  }

  // Prevent concurrent purchases of the same product overwriting the resolver map.
  // Also block new purchases while a previous timed-out purchase is still recovering.
  if (activePurchaseSessions.has(productId)) {
    return { success: false, error: 'A purchase is already in progress for this product' };
  }
  if (pendingRecovery.get(productId)) {
    return { success: false, error: 'A previous purchase is still being processed — please wait before trying again' };
  }

  // Android Play Billing v5+ requires the offerToken for the subscription offer;
  // react-native-iap throws without it. Ensure it's cached (getSubscriptionProducts
  // populates it); fetch on demand if the catalogue wasn't loaded yet.
  let offerToken = subscriptionOfferTokens.get(productId);
  if (!offerToken) {
    try {
      const subs = await getSubscriptions({ skus: SUBSCRIPTION_IDS });
      const store = subs.find((s) => s.productId === productId);
      if (store) {
        const info = readAndroidSubscription(store);
        if (info.offerToken) {
          offerToken = info.offerToken;
          subscriptionOfferTokens.set(productId, info.offerToken);
        }
      }
    } catch {
      // handled by the offerToken guard below
    }
  }
  if (!offerToken) {
    return {
      success: false,
      error: 'Subscription offer is unavailable right now — please try again shortly',
    };
  }
  const resolvedOfferToken = offerToken;

  const sessionId = randomUUID();
  const purchasePromise = new Promise<{ success: boolean; plan?: string; coinsGranted?: number; purchaseToken?: string; error?: string }>((resolve) => {
    purchaseResolvers.set(sessionId, (outcome) => {
      if (outcome.status === 'success') {
        resolve({ success: true, plan: outcome.plan, coinsGranted: outcome.coinsGranted });
      } else {
        resolve({ success: false, error: outcome.error });
      }
    });
    activePurchaseSessions.set(productId, sessionId);

    requestSubscription({
      subscriptionOffers: [{ sku: productId, offerToken: resolvedOfferToken }],
    }).catch((err: unknown) => {
      // Errors usually arrive via purchaseErrorListener; this is a safety net.
      if (!purchaseResolvers.has(sessionId)) return;
      purchaseResolvers.delete(sessionId);
      activePurchaseSessions.delete(productId);
      resolve({ success: false, error: err instanceof Error ? err.message : 'Purchase failed' });
    });
  });

  // When the timeout fires the resolver is removed but the purchase continues
  // running in the background. Mark pendingRecovery so the listener can deliver
  // the late result and prevent the user from initiating a duplicate purchase.
  const timeoutPromise = new Promise<{ success: boolean; error: string }>((resolve) =>
    setTimeout(() => {
      purchaseResolvers.delete(sessionId);
      activePurchaseSessions.delete(productId);
      pendingRecovery.set(productId, true);
      resolve({ success: false, error: 'Your purchase is still processing — please wait before trying again' });
    }, 5 * 60 * 1000)
  );

  return Promise.race([purchasePromise, timeoutPromise]);
}
