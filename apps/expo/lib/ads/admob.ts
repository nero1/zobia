/**
 * lib/ads/admob.ts
 *
 * AdMob rewarded ad integration.
 * Only shown to free-tier users (max 5 per day, enforced server-side).
 *
 * Uses expo-ads-admob or @react-native-google-mobile-ads.
 * Ad unit IDs are read from environment variables.
 */

import { Platform } from 'react-native';
import {
  RewardedAd,
  RewardedAdEventType,
  AdEventType,
  TestIds,
  BannerAd,
  BannerAdSize,
  InterstitialAd,
} from 'react-native-google-mobile-ads';

// ---------------------------------------------------------------------------
// Ad Unit IDs
// ---------------------------------------------------------------------------

const IS_DEV = __DEV__;

export const REWARDED_AD_UNIT_ID: string = IS_DEV
  ? TestIds.REWARDED
  : Platform.select({
      android: process.env.EXPO_PUBLIC_ADMOB_REWARDED_ANDROID ?? TestIds.REWARDED,
      ios: process.env.EXPO_PUBLIC_ADMOB_REWARDED_IOS ?? TestIds.REWARDED,
      default: TestIds.REWARDED,
    }) ?? TestIds.REWARDED;

// ---------------------------------------------------------------------------
// Ad instance management
// ---------------------------------------------------------------------------

let rewardedAd: RewardedAd | null = null;
let adLoaded = false;

/**
 * Pre-load a rewarded ad. Call this ahead of when you'll show it.
 */
export async function loadRewardedAd(): Promise<void> {
  return new Promise((resolve, reject) => {
    rewardedAd = RewardedAd.createForAdRequest(REWARDED_AD_UNIT_ID, {
      requestNonPersonalizedAdsOnly: true,
    });

    const unsubscribeLoaded = rewardedAd.addAdEventListener(
      RewardedAdEventType.LOADED,
      () => {
        adLoaded = true;
        unsubscribeLoaded();
        resolve();
      }
    );

    const unsubscribeError = rewardedAd.addAdEventListener(
      AdEventType.ERROR,
      (error) => {
        adLoaded = false;
        unsubscribeError();
        reject(error);
      }
    );

    rewardedAd.load();
  });
}

// ---------------------------------------------------------------------------
// Ad display
// ---------------------------------------------------------------------------

export interface RewardedAdResult {
  rewarded: boolean;
  reward?: {
    type: string;
    amount: number;
  };
}

/**
 * Show the pre-loaded rewarded ad.
 * Returns reward info if the user watched the full ad, or { rewarded: false }.
 */
export async function showRewardedAd(): Promise<RewardedAdResult> {
  if (!rewardedAd || !adLoaded) {
    // Try to load if not ready
    try {
      await loadRewardedAd();
    } catch {
      return { rewarded: false };
    }
  }

  return new Promise((resolve) => {
    if (!rewardedAd) {
      resolve({ rewarded: false });
      return;
    }

    const unsubscribeEarned = rewardedAd.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      (reward) => {
        adLoaded = false;
        rewardedAd = null;
        unsubscribeEarned();
        resolve({
          rewarded: true,
          reward: { type: reward.type, amount: reward.amount },
        });
      }
    );

    const unsubscribeClose = rewardedAd.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        adLoaded = false;
        rewardedAd = null;
        unsubscribeClose();
        // BUG-MOB-23: also unsubscribe the earned listener to prevent a leak when
        // the user closes the ad without watching it to completion.
        unsubscribeEarned();
        resolve({ rewarded: false });
      }
    );

    rewardedAd.show().catch(() => {
      resolve({ rewarded: false });
    });
  });
}

/**
 * Check if a rewarded ad is currently loaded and ready.
 */
export function isRewardedAdLoaded(): boolean {
  return adLoaded;
}

// ---------------------------------------------------------------------------
// Banner Ad support
// ---------------------------------------------------------------------------

export { BannerAd, BannerAdSize };

export const BANNER_AD_UNIT_ID: string = IS_DEV
  ? TestIds.BANNER
  : Platform.select({
      android: process.env.EXPO_PUBLIC_ADMOB_BANNER_ANDROID ?? TestIds.BANNER,
      ios: process.env.EXPO_PUBLIC_ADMOB_BANNER_IOS ?? TestIds.BANNER,
      default: TestIds.BANNER,
    }) ?? TestIds.BANNER;

// ---------------------------------------------------------------------------
// Interstitial Ad support
// ---------------------------------------------------------------------------

export const INTERSTITIAL_AD_UNIT_ID: string = IS_DEV
  ? TestIds.INTERSTITIAL
  : Platform.select({
      android: process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_ANDROID ?? TestIds.INTERSTITIAL,
      ios: process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_IOS ?? TestIds.INTERSTITIAL,
      default: TestIds.INTERSTITIAL,
    }) ?? TestIds.INTERSTITIAL;

let interstitialAd: InterstitialAd | null = null;
let interstitialLoaded = false;

/** Pre-load an interstitial ad. */
export async function loadInterstitialAd(): Promise<void> {
  return new Promise((resolve, reject) => {
    interstitialAd = InterstitialAd.createForAdRequest(INTERSTITIAL_AD_UNIT_ID, {
      requestNonPersonalizedAdsOnly: true,
    });

    const unsubLoaded = interstitialAd.addAdEventListener(
      AdEventType.LOADED,
      () => {
        interstitialLoaded = true;
        unsubLoaded();
        resolve();
      }
    );

    const unsubError = interstitialAd.addAdEventListener(
      AdEventType.ERROR,
      (error) => {
        interstitialLoaded = false;
        unsubError();
        reject(error);
      }
    );

    interstitialAd.load();
  });
}

/**
 * Show the pre-loaded interstitial ad.
 * Only shown to free-tier users. Returns true if shown.
 */
export async function showInterstitialAd(
  onDismissed?: () => void
): Promise<boolean> {
  if (!interstitialAd || !interstitialLoaded) {
    try {
      await loadInterstitialAd();
    } catch {
      return false;
    }
  }

  return new Promise((resolve) => {
    if (!interstitialAd) {
      resolve(false);
      return;
    }

    const unsubClosed = interstitialAd.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        interstitialLoaded = false;
        interstitialAd = null;
        unsubClosed();
        onDismissed?.();
        resolve(true);
        // Pre-load next one
        loadInterstitialAd().catch(() => {});
      }
    );

    interstitialAd.show().catch(() => {
      interstitialLoaded = false;
      interstitialAd = null;
      resolve(false);
    });
  });
}
