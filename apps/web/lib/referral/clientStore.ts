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
const VISITOR_KEY_STORAGE_KEY = "zobia_visitor_key";
/** Referrer ids already recorded as visited this browser session — avoids a
 *  redundant POST on every SPA navigation while the same `?r=` stays in the URL. */
const seenThisSession = new Set<string>();

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

/**
 * A random, non-PII id identifying this browser for referral-visit dedup
 * (see POST /api/referrals/visit). Generated once and persisted; never an
 * IP address or fingerprint, and never sent anywhere except that endpoint.
 */
function getOrCreateVisitorKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let key = window.localStorage.getItem(VISITOR_KEY_STORAGE_KEY);
    if (!key) {
      key = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      window.localStorage.setItem(VISITOR_KEY_STORAGE_KEY, key);
    }
    return key;
  } catch {
    return null;
  }
}

/**
 * Record a referral-link visit, best-effort and fire-and-forget. Deduped
 * client-side per (referrer code, browser session) so an SPA navigation that
 * keeps the same `?r=` in the URL doesn't re-POST; the server additionally
 * dedups per (referrer, visitor, calendar day) so this is safe to call once
 * per page load even across sessions.
 */
export function recordReferralVisit(code: string, path: string): void {
  if (typeof window === "undefined" || seenThisSession.has(code)) return;
  const visitorKey = getOrCreateVisitorKey();
  if (!visitorKey) return;
  seenThisSession.add(code);

  try {
    fetch("/api/referrals/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, path, visitorKey }),
      keepalive: true,
    }).catch(() => {
      // Best-effort — losing a visit count is not user-visible and never blocks navigation.
    });
  } catch {
    /* fetch unavailable in this environment — skip */
  }
}
