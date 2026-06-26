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
import mobileAds, {
  AdsConsent,
  AdsConsentStatus,
  RewardedAd,
  RewardedAdEventType,
  AdEventType,
  TestIds,
  BannerAd,
  BannerAdSize,
  InterstitialAd,
} from 'react-native-google-mobile-ads';

// ---------------------------------------------------------------------------
// SDK initialization
// ---------------------------------------------------------------------------

let adsInitialized = false;

/**
 * Initialize the Google Mobile Ads SDK. MUST be called once at app startup
 * (before any ad is loaded) or ads silently never serve — `RewardedAd.load()`
 * and `<BannerAd />` will just error/no-fill.
 *
 * The native AdMob app ID itself is configured separately, in app.json under
 * the ROOT-level `react-native-google-mobile-ads` key (android_app_id /
 * ios_app_id). That key is read at build time by the library's own Gradle
 * script (android/app-json.gradle), NOT by an Expo config plugin — so it lives
 * as a sibling of the `expo` object, and Expo CLI's "Ignoring extra key" warning
 * for it is expected and harmless.
 *
 * Safe to call multiple times; initialization only runs once.
 */
export async function initializeAds(): Promise<void> {
  if (adsInitialized) return;
  adsInitialized = true;
  try {
    // BUG-020 FIX: request UMP consent before initializing the SDK. The SDK
    // should only serve personalized ads when the user has consented; for all
    // other statuses (NOT_REQUIRED, UNKNOWN, OBTAINED without purpose 1) we
    // configure the SDK to serve non-personalized ads only.
    try {
      const consentInfo = await AdsConsent.requestInfoUpdate();
      if (
        consentInfo.isConsentFormAvailable &&
        consentInfo.status === AdsConsentStatus.REQUIRED
      ) {
        await AdsConsent.showForm();
      }
    } catch (consentErr) {
      // Consent failure must not block ad initialization — degrade to
      // non-personalized ads which are safe in all regions.
      console.warn('[ads] UMP consent flow failed; using non-personalized ads', consentErr);
    }

    await mobileAds().initialize();
  } catch (err) {
    // Don't let an ads failure block app startup.
    adsInitialized = false;
    console.warn('[ads] Google Mobile Ads init failed', err);
  }
}

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
let adLoading = false;

/**
 * Pre-load a rewarded ad. Call this ahead of when you'll show it.
 * Returns immediately if an ad is already loaded or currently loading.
 */
export async function loadRewardedAd(): Promise<void> {
  if (adLoaded || adLoading) return;
  adLoading = true;

  return new Promise((resolve, reject) => {
    rewardedAd = RewardedAd.createForAdRequest(REWARDED_AD_UNIT_ID, {
      requestNonPersonalizedAdsOnly: true,
    });

    const unsubscribeLoaded = rewardedAd.addAdEventListener(
      RewardedAdEventType.LOADED,
      () => {
        adLoaded = true;
        adLoading = false;
        unsubscribeError();
        unsubscribeLoaded();
        resolve();
      }
    );

    const unsubscribeError = rewardedAd.addAdEventListener(
      AdEventType.ERROR,
      (error) => {
        adLoaded = false;
        adLoading = false;
        unsubscribeLoaded();
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

    let earnedResult: RewardedAdResult | null = null;
    let resolved = false;

    const settle = (result: RewardedAdResult) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    const unsubscribeEarned = rewardedAd.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      (reward) => {
        earnedResult = { rewarded: true, reward: { type: reward.type, amount: reward.amount } };
        unsubscribeEarned();
        // Resolve immediately — CLOSED may not fire on all SDK versions.
        settle(earnedResult);
      }
    );

    const unsubscribeClose = rewardedAd.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        adLoaded = false;
        rewardedAd = null;
        unsubscribeClose();
        unsubscribeEarned();
        // BUG-016 FIX: resolve immediately using earnedResult captured by the
        // EARNED_REWARD handler. The previous 150 ms setTimeout could lose the
        // reward on slow devices or when EARNED_REWARD fires after CLOSED.
        // EARNED_REWARD already calls settle() which guards against double-resolve.
        settle(earnedResult ?? { rewarded: false });
      }
    );

    rewardedAd.show().catch(() => {
      adLoaded = false;
      rewardedAd = null;
      unsubscribeEarned();
      unsubscribeClose();
      settle({ rewarded: false });
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
let interstitialLoading = false;

/** Pre-load an interstitial ad. */
export async function loadInterstitialAd(): Promise<void> {
  if (interstitialLoading || interstitialLoaded) return Promise.resolve();
  interstitialLoading = true;
  return new Promise((resolve, reject) => {
    interstitialAd = InterstitialAd.createForAdRequest(INTERSTITIAL_AD_UNIT_ID, {
      requestNonPersonalizedAdsOnly: true,
    });

    const unsubLoaded = interstitialAd.addAdEventListener(
      AdEventType.LOADED,
      () => {
        interstitialLoaded = true;
        interstitialLoading = false;
        unsubError();
        unsubLoaded();
        resolve();
      }
    );

    const unsubError = interstitialAd.addAdEventListener(
      AdEventType.ERROR,
      (error) => {
        interstitialLoaded = false;
        interstitialLoading = false;
        unsubLoaded();
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
      unsubClosed();
      interstitialLoaded = false;
      interstitialAd = null;
      resolve(false);
    });
  });
}
