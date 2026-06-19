/**
 * apps/web/lib/referral/clientStore.ts
 *
 * Client-side persistence for a captured referral code on web + PWA.
 *
 * A referral code arrives as `?r=<code>` on ANY public URL. We persist it so
 * attribution survives navigation, a page reload, the signup flow, and even an
 * app reinstall-of-tab (localStorage). Both a cookie and localStorage are
 * written: the cookie lets server code read it if ever needed; localStorage is
 * the durable client copy. The value is replayed at onboarding and then
 * cleared so a later organic signup is not misattributed.
 */

import { isValidReferralCode } from "@zobia/shared/utils";

const STORAGE_KEY = "zobia_ref";
const COOKIE_NAME = "zobia_ref";
const TTL_DAYS = 30;

/** Persist a referral code (validated) to localStorage + a first-party cookie. */
export function storeReferralCode(code: string): void {
  if (typeof window === "undefined" || !isValidReferralCode(code)) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // localStorage may be unavailable (private mode / quota) — cookie still set.
  }

  const maxAge = TTL_DAYS * 24 * 60 * 60;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(code)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
}

/** Read the stored referral code (localStorage first, then cookie). */
export function getStoredReferralCode(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const fromLs = window.localStorage.getItem(STORAGE_KEY);
    if (isValidReferralCode(fromLs)) return fromLs;
  } catch {
    /* ignore */
  }

  const match = document.cookie.match(/(?:^|;\s*)zobia_ref=([^;]+)/);
  if (match) {
    const value = decodeURIComponent(match[1]);
    if (isValidReferralCode(value)) return value;
  }
  return null;
}

/** Clear the stored referral code once it has been consumed at signup. */
export function clearStoredReferralCode(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
}
