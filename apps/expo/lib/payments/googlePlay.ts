/**
 * lib/payments/googlePlay.ts
 *
 * Google Play Billing integration (Android only).
 * Uses expo-in-app-purchases for coin top-ups.
 *
 * Product IDs must be created in the Google Play Console.
 * Matching coin amounts are defined below.
 */

import { Platform } from 'react-native';
import * as InAppPurchases from 'expo-in-app-purchases';

// ---------------------------------------------------------------------------
// Product catalogue
// ---------------------------------------------------------------------------

export interface CoinProduct {
  id: string;
  price: string;
  coins: number;
  title?: string;
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

const PRODUCT_IDS = COIN_PRODUCTS.map((p) => p.id);

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
 * @param productId - Play Store product ID (e.g. 'coins_500')
 * @returns Purchase result with coin amount, or failure info
 */
export async function purchaseCoins(productId: string): Promise<{
  success: boolean;
  coins: number;
  purchaseToken?: string;
  error?: string;
}> {
  if (Platform.OS !== 'android') {
    return { success: false, coins: 0, error: 'Google Play only available on Android' };
  }

  const product = COIN_PRODUCTS.find((p) => p.id === productId);
  if (!product) {
    return { success: false, coins: 0, error: 'Unknown product ID' };
  }

  return new Promise((resolve) => {
    // Set up purchase listener
    InAppPurchases.setPurchaseListener(({ responseCode, results, errorCode }) => {
      if (responseCode === InAppPurchases.IAPResponseCode.OK && results) {
        const purchase = results.find((r) => r.productId === productId);
        if (purchase) {
          // Acknowledge purchase to avoid refund
          void InAppPurchases.finishTransactionAsync(purchase, false);
          resolve({
            success: true,
            coins: product.coins,
            purchaseToken: purchase.purchaseToken ?? undefined,
          });
        }
      } else if (responseCode === InAppPurchases.IAPResponseCode.USER_CANCELED) {
        resolve({ success: false, coins: 0, error: 'Purchase cancelled' });
      } else {
        resolve({ success: false, coins: 0, error: `Purchase failed (code ${errorCode})` });
      }
    });

    // Initiate purchase
    InAppPurchases.purchaseItemAsync(productId).catch((err: Error) => {
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
