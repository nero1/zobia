/**
 * apps/expo/lib/deeplinks/referral.ts
 *
 * Native counterpart to the web ReferralCapture. A referral code arrives as a
 * `?r=<code>` query parameter on an inbound deep link (zobia://…?r=) or
 * universal link (https://zobia…/u/joe?r=). We parse it, validate it with the
 * shared rules, and persist it to MMKV so it survives until onboarding, where
 * it is replayed for attribution and then cleared.
 *
 * Wired up in app/_layout.tsx via useReferralCaptureFromLink().
 */

import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { extractReferralCode, isValidReferralCode } from '@zobia/shared/utils';
import { STORE_KEYS, setItem, getItem, removeItem } from '@/lib/offline/store';

/** Parse `?r=` from any URL string and persist it if valid. */
export function captureReferralFromUrl(url: string | null | undefined): void {
  if (!url) return;
  try {
    const { queryParams } = Linking.parse(url);
    const code = extractReferralCode(queryParams ?? undefined);
    if (code) setItem(STORE_KEYS.PENDING_REFERRAL, code);
  } catch {
    // Malformed URL — ignore.
  }
}

/** Read the pending referral code (validated), or null. */
export function getPendingReferralCode(): string | null {
  const code = getItem<string | null>(STORE_KEYS.PENDING_REFERRAL, null);
  return isValidReferralCode(code) ? code : null;
}

/** Clear the pending referral once consumed at signup. */
export function clearPendingReferralCode(): void {
  removeItem(STORE_KEYS.PENDING_REFERRAL);
}

/**
 * Hook: capture a referral code from the launch URL (cold start) and from any
 * link received while the app is running (warm). Call once at the app root.
 *
 * BUG-004 FIX: accepts `storeReady` and only runs after MMKV is initialised.
 * captureReferralFromUrl → setItem() → getStorage() throws if initStore()
 * hasn't been called yet, which on cold launch races with MMKV bootstrap.
 */
export function useReferralCaptureFromLink(storeReady = false): void {
  useEffect(() => {
    if (!storeReady) return;

    // Cold start: app opened directly from a referral link.
    Linking.getInitialURL()
      .then(captureReferralFromUrl)
      .catch(() => {});

    // Warm: link received while the app is already open.
    const sub = Linking.addEventListener('url', ({ url }) => captureReferralFromUrl(url));
    return () => sub.remove();
  }, [storeReady]);
}
