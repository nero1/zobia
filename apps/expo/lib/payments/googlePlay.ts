/**
 * lib/payments/googlePlay.ts
 *
 * Google Play Billing integration (Android only).
 * Uses expo-in-app-purchases for coin top-ups and subscription plans.
 *
 * Product IDs must be created in the Google Play Console.
 * Matching coin amounts are defined below.
 *
 * Purchase flow (coins):
 *  1. purchaseCoins() triggers the Google Play billing sheet
 *  2. The global listener receives the purchase and calls verifyPurchaseServerSide
 *  3. Server verifies with Google Play Developer API and credits coins
 *  4. finishTransactionAsync() is called ONLY after confirmed server credit
 *
 * Purchase flow (subscriptions):
 *  1. purchaseSubscription() triggers the Google Play billing sheet
 *  2. The global listener receives the purchase and calls verifyPurchaseServerSide
 *  3. Server verifies with Google Play subscriptions API and activates plan
 *  4. finishTransactionAsync(purchase, false) acknowledges ONLY after server credit
 */

import { Platform } from 'react-native';
import * as InAppPurchases from 'expo-in-app-purchases';
import { apiClient } from '@/lib/api/client';
import { randomUUID } from 'expo-crypto';

// ---------------------------------------------------------------------------
// Product catalogue
// ---------------------------------------------------------------------------

export interface CoinProduct {
  id: string;
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
const COIN_PRODUCTS: CoinProduct[] = [
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

type PurchaseResolver = (result: { coinsGranted?: number; plan?: string } | null) => void;

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
 * Register the single global purchase listener.
 * Must be called once after connectAsync() succeeds.
 */
function setupGlobalPurchaseListener(): void {
  InAppPurchases.setPurchaseListener(async ({ responseCode, results }) => {
    if (responseCode === InAppPurchases.IAPResponseCode.OK && results) {
      for (const purchase of results) {
        const sessionId = activePurchaseSessions.get(purchase.productId);
        if (!sessionId) continue;
        const resolver = purchaseResolvers.get(sessionId);
        if (!resolver || !purchase.purchaseToken) continue;

        // Remove before async work to prevent double-resolution.
        activePurchaseSessions.delete(purchase.productId);
        purchaseResolvers.delete(sessionId);

        const isSubscription = SUBSCRIPTION_IDS.includes(purchase.productId);

        // BUG-05: verify server-side FIRST; only consume/acknowledge on success.
        const verifyResult = await verifyPurchaseServerSide(
          purchase.purchaseToken,
          purchase.productId,
          'com.zobia.app',
          isSubscription
        ).catch(() => null);

        if (verifyResult !== null) {
          // Only finish the transaction after confirmed server credit.
          try {
            await InAppPurchases.finishTransactionAsync(purchase, false);
          } catch (finishErr) {
            console.warn('[googlePlay] finishTransactionAsync failed:', finishErr);
          }
        }
        // If verifyResult === null we do NOT consume so Play Store can replay it.

        resolver(verifyResult);
      }
    }
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

  await InAppPurchases.connectAsync();
  setupGlobalPurchaseListener();
  initialised = true;
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
    const { responseCode, results } = await InAppPurchases.getProductsAsync(PRODUCT_IDS);

    if (responseCode !== InAppPurchases.IAPResponseCode.OK || !results) {
      return COIN_PRODUCTS;
    }

    return COIN_PRODUCTS.map((local) => {
      const store = results.find((r) => r.productId === local.id);
      return store
        ? { ...local, price: store.price ?? local.price, title: store.title }
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
 * @param productId   - Play Store product ID (e.g. 'coins_starter')
 * @param packageName - App package name (e.g. 'com.zobia.app')
 * @returns Purchase result with coins granted, or failure info
 */
export async function purchaseCoins(
  productId: string,
  packageName = 'com.zobia.app'
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

  // Prevent concurrent purchases of the same product overwriting the resolver map
  if (activePurchaseSessions.has(productId)) {
    return { success: false, coins: 0, error: 'A purchase is already in progress for this product' };
  }

  const sessionId = randomUUID();
  return new Promise((resolve) => {
    purchaseResolvers.set(sessionId, (result) => {
      if (result !== null) {
        resolve({ success: true, coins: result.coinsGranted ?? 0 });
      } else {
        resolve({
          success: false,
          coins: 0,
          error: 'Server verification failed — please contact support if coins are missing',
        });
      }
    });
    activePurchaseSessions.set(productId, sessionId);

    InAppPurchases.purchaseItemAsync(productId).catch((err: Error) => {
      purchaseResolvers.delete(sessionId);
      activePurchaseSessions.delete(productId);
      resolve({ success: false, coins: 0, error: err.message });
    });
  });
}

/**
 * Disconnect from Google Play Billing. Call on app unmount.
 */
export async function disconnectGooglePlayBilling(): Promise<void> {
  if (Platform.OS !== 'android' || !initialised) return;
  await InAppPurchases.disconnectAsync();
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
    const { responseCode, results } = await InAppPurchases.getProductsAsync(SUBSCRIPTION_IDS);

    if (responseCode !== InAppPurchases.IAPResponseCode.OK || !results) {
      return localProducts;
    }

    return localProducts.map((local) => {
      const store = results.find((r) => r.productId === local.id);
      return store
        ? { ...local, monthlyPrice: store.price ?? local.monthlyPrice }
        : local;
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
 * @param productId   - Subscription product ID (e.g. 'sub_plus_monthly')
 * @param packageName - App package name (e.g. 'com.zobia.app')
 */
export async function purchaseSubscription(
  productId: string,
  packageName = 'com.zobia.app'
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

  // Prevent concurrent purchases of the same product overwriting the resolver map
  if (activePurchaseSessions.has(productId)) {
    return { success: false, error: 'A purchase is already in progress for this product' };
  }

  const sessionId = randomUUID();
  return new Promise((resolve) => {
    purchaseResolvers.set(sessionId, (result) => {
      if (result !== null) {
        resolve({
          success: true,
          plan: result.plan,
          coinsGranted: result.coinsGranted,
        });
      } else {
        resolve({
          success: false,
          error: 'Server verification failed — please contact support if coins are missing',
        });
      }
    });
    activePurchaseSessions.set(productId, sessionId);

    InAppPurchases.purchaseItemAsync(productId).catch((err: Error) => {
      purchaseResolvers.delete(sessionId);
      activePurchaseSessions.delete(productId);
      resolve({ success: false, error: err.message });
    });
  });
}
