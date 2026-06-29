/**
 * apps/android/src/lib/deeplinks/referral.ts
 *
 * Adapted from apps/expo/lib/deeplinks/referral.ts.
 * Changes:
 *  - expo-linking → @capacitor/app App.addListener('appUrlOpen')
 *  - MMKV → @capacitor/preferences
 */

import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { extractReferralCode, isValidReferralCode } from '@zobia/shared/utils';

const PENDING_REFERRAL_KEY = 'pending_referral';

export function captureReferralFromUrl(url: string | null | undefined): void {
  if (!url) return;
  try {
    const parsed = new URL(url);
    const qp: Record<string, string> = {};
    parsed.searchParams.forEach((v, k) => { qp[k] = v; });
    const code = extractReferralCode(qp);
    if (code) {
      Preferences.set({ key: PENDING_REFERRAL_KEY, value: code });
    }
  } catch {
    // Malformed URL — ignore.
  }
}

export async function getPendingReferralCode(): Promise<string | null> {
  const { value: code } = await Preferences.get({ key: PENDING_REFERRAL_KEY });
  return isValidReferralCode(code) ? code : null;
}

export async function clearPendingReferralCode(): Promise<void> {
  await Preferences.remove({ key: PENDING_REFERRAL_KEY });
}

/**
 * Hook: capture referral code from cold-start URL and warm links.
 * Call once at app root.
 */
export function useReferralCaptureFromLink(): void {
  useEffect(() => {
    let handle: { remove: () => void } | null = null;

    App.addListener('appUrlOpen', ({ url }) => {
      captureReferralFromUrl(url);
    }).then((h) => { handle = h; });

    return () => {
      handle?.remove();
    };
  }, []);
}
