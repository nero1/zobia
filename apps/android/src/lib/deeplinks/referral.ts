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

// ZSB-13 fix: parity with apps/web/lib/referral/clientStore.ts's TTL_DAYS —
// a referral code captured here previously never expired, unlike web/PWA's
// 30-day cookie/localStorage TTL, so a link tapped a year ago could still
// misattribute a much-later organic signup.
const TTL_DAYS = 30;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

interface StoredReferral {
  code: string;
  capturedAt: number;
}

export function captureReferralFromUrl(url: string | null | undefined): void {
  if (!url) return;
  try {
    const parsed = new URL(url);
    const qp: Record<string, string> = {};
    parsed.searchParams.forEach((v, k) => { qp[k] = v; });
    const code = extractReferralCode(qp);
    if (code) {
      const stored: StoredReferral = { code, capturedAt: Date.now() };
      Preferences.set({ key: PENDING_REFERRAL_KEY, value: JSON.stringify(stored) });
    }
  } catch {
    // Malformed URL — ignore.
  }
}

export async function getPendingReferralCode(): Promise<string | null> {
  const { value: raw } = await Preferences.get({ key: PENDING_REFERRAL_KEY });
  if (!raw) return null;

  // Back-compat: older installs may still have a bare code string stored
  // (no capturedAt) — treat those as already-expired rather than crash on
  // JSON.parse, since we can't tell how old they are.
  let stored: StoredReferral | null = null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredReferral>;
    if (typeof parsed.code === 'string' && typeof parsed.capturedAt === 'number') {
      stored = parsed as StoredReferral;
    }
  } catch {
    stored = null;
  }

  if (!stored || !isValidReferralCode(stored.code) || Date.now() - stored.capturedAt > TTL_MS) {
    await clearPendingReferralCode();
    return null;
  }

  return stored.code;
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
