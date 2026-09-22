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
import { apiClient } from '@/lib/api/client';

const PENDING_REFERRAL_KEY = 'pending_referral';
const VISITOR_KEY_STORAGE_KEY = 'zobia_visitor_key';

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

/**
 * A random, non-PII id identifying this device install for referral-visit
 * dedup (see POST /api/referrals/visit) — never an IP or device fingerprint.
 * Generated once and persisted in Preferences.
 */
async function getOrCreateVisitorKey(): Promise<string> {
  const { value: existing } = await Preferences.get({ key: VISITOR_KEY_STORAGE_KEY });
  if (existing) return existing;
  const key = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await Preferences.set({ key: VISITOR_KEY_STORAGE_KEY, value: key });
  return key;
}

/**
 * Record a referral-link visit, best-effort and fire-and-forget — mirrors
 * apps/web/lib/referral/clientStore.ts's recordReferralVisit so a deep link
 * shared from the web/PWA and opened in this app attributes the visit to
 * the same referrer stats, regardless of which surface it lands on.
 */
async function recordReferralVisit(code: string, path: string): Promise<void> {
  try {
    const visitorKey = await getOrCreateVisitorKey();
    await apiClient.post('/referrals/visit', { code, path, visitorKey });
  } catch {
    // Best-effort — losing a visit count is not user-visible.
  }
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
      void recordReferralVisit(code, parsed.pathname || '/');
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
