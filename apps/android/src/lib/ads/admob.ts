/**
 * apps/android/src/lib/ads/admob.ts
 *
 * AdMob integration for the Capacitor Android app (PRD §17 Pillar 3 —
 * "Admob ads show in the capacitor/android app in addition to other ads").
 * Ad unit IDs and test-mode are admin-configurable via x_manifest
 * (ad_admob_*, see apps/web/lib/manifest/index.ts `ads.admob`), fetched
 * from GET /api/manifest and cached like every other manifest-driven config
 * in this app (react-query, 5 min staleTime — no extra network/Redis cost).
 *
 * ZB-AND-15 fix: this used to keep its own bare module-level `cachedConfig`
 * with no expiry at all, unlike every other manifest-driven setting in this
 * app (which reads through useManifest()'s react-query cache, 5 min
 * staleTime) — an admin rotating a compromised ad unit ID or disabling
 * `admobAds` would never take effect for an already-open session. These
 * functions are plain async functions called from event handlers (not React
 * hooks), so they read/refresh the same cache non-reactively via the shared
 * `queryClient` singleton instead.
 *
 * Free-tier gating and the AdMob App ID (native-side, AndroidManifest.xml)
 * must be configured before shipping to Play Store — see docs/SETUP.md.
 */

import { AdMob, BannerAdPosition, BannerAdSize } from '@capacitor-community/admob';
import { queryClient } from '@/lib/query/client';
import { MANIFEST_QUERY_KEY, MANIFEST_STALE_TIME, fetchManifest, type Manifest } from '@/lib/hooks/useManifest';

interface AdMobManifestConfig {
  appId: string;
  bannerUnitId: string;
  interstitialUnitId: string;
  rewardedUnitId: string;
  testMode: boolean;
}

interface ManifestResponse extends Manifest {
  features?: { admobAds?: boolean };
  ads?: { admob?: AdMobManifestConfig };
}

let initialized = false;

// Google's official test ad unit IDs — used whenever testMode is on or a
// real unit ID hasn't been configured yet, so the integration is always
// safe to ship without risking policy violations from serving test
// impressions as if they were live inventory.
const TEST_UNIT_IDS = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
};

async function getConfig(): Promise<AdMobManifestConfig | null> {
  try {
    const data = await queryClient.fetchQuery<Manifest>({
      queryKey: MANIFEST_QUERY_KEY,
      queryFn: fetchManifest,
      staleTime: MANIFEST_STALE_TIME,
    }) as ManifestResponse;
    if (!data.features?.admobAds) return null;
    return data.ads?.admob ?? { appId: '', bannerUnitId: '', interstitialUnitId: '', rewardedUnitId: '', testMode: true };
  } catch {
    return null;
  }
}

async function ensureInitialized(): Promise<boolean> {
  const config = await getConfig();
  if (!config) return false;
  if (!initialized) {
    await AdMob.initialize({ initializeForTesting: config.testMode });
    initialized = true;
  }
  return true;
}

export async function showBanner(size: BannerAdSize = BannerAdSize.BANNER): Promise<void> {
  const config = await getConfig();
  if (!(await ensureInitialized()) || !config) return;
  await AdMob.showBanner({
    adId: config.testMode || !config.bannerUnitId ? TEST_UNIT_IDS.banner : config.bannerUnitId,
    adSize: size,
    position: BannerAdPosition.BOTTOM_CENTER,
    isTesting: config.testMode,
  });
}

export async function hideBanner(): Promise<void> {
  if (!initialized) return;
  await AdMob.hideBanner().catch(() => {});
}

export async function showInterstitial(): Promise<void> {
  const config = await getConfig();
  if (!(await ensureInitialized()) || !config) return;
  await AdMob.prepareInterstitial({
    adId: config.testMode || !config.interstitialUnitId ? TEST_UNIT_IDS.interstitial : config.interstitialUnitId,
    isTesting: config.testMode,
  });
  await AdMob.showInterstitial();
}

export interface RewardResult {
  type: string;
  amount: number;
}

export async function showRewarded(): Promise<RewardResult | null> {
  const config = await getConfig();
  if (!(await ensureInitialized()) || !config) return null;
  await AdMob.prepareRewardVideoAd({
    adId: config.testMode || !config.rewardedUnitId ? TEST_UNIT_IDS.rewarded : config.rewardedUnitId,
    isTesting: config.testMode,
  });
  const result = await AdMob.showRewardVideoAd();
  return result ?? null;
}

/** Whether AdMob should be offered at all for this viewer (admin flag + plan gating happens server-side). */
export async function isAdMobEnabled(): Promise<boolean> {
  return (await getConfig()) !== null;
}
