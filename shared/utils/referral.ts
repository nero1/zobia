/**
 * shared/utils/referral.ts
 *
 * Single source of truth for the referral-link format, shared by web, PWA and
 * Expo. A referral is carried by a `?r=<code>` query parameter that can be
 * attached to ANY public URL — the landing page, a profile, a room, a game or
 * a course. The parameter is captured on the client (cookie / localStorage on
 * web, SecureStore on native) and replayed at signup so attribution survives
 * across the whole funnel.
 *
 *   https://zobia.org/?r=74392
 *   https://zobia.org/u/joe?r=74392
 *   https://zobia.org/r/dorcas-cuisine?r=74392
 *   https://zobia.org/g/tapontap?r=74392
 *   https://zobia.org/c/make-money-online?r=74392
 */

/** The query-string key that carries a referral code. Do not rename. */
export const REFERRAL_PARAM = "r";

/**
 * Referral codes are short numeric/alphanumeric strings (the platform issues
 * 9–10 character codes). We bound the length to 20 — matching the server's
 * validation in /api/onboarding/complete — so a hostile or malformed value
 * (e.g. a giant pasted blob, or a code crafted to exceed the server limit and
 * block a victim's onboarding) is never stored or replayed.
 */
const MAX_REFERRAL_CODE_LENGTH = 20;
const REFERRAL_CODE_RE = /^[A-Za-z0-9_-]{1,20}$/;

/** True when a candidate string is a plausible referral code. */
export function isValidReferralCode(code: string | null | undefined): code is string {
  return (
    typeof code === "string" &&
    code.length > 0 &&
    code.length <= MAX_REFERRAL_CODE_LENGTH &&
    REFERRAL_CODE_RE.test(code)
  );
}

/**
 * Extract and validate a referral code from anything URLSearchParams-like
 * (the web `URLSearchParams`, Next's `ReadonlyURLSearchParams`, or Expo's
 * parsed `queryParams` record). Returns null when absent or invalid.
 */
export function extractReferralCode(
  params:
    | URLSearchParams
    | { get(key: string): string | null }
    | Record<string, string | string[] | undefined>
    | null
    | undefined
): string | null {
  if (!params) return null;

  let raw: string | string[] | null | undefined;
  if (typeof (params as URLSearchParams).get === "function") {
    raw = (params as URLSearchParams).get(REFERRAL_PARAM);
  } else {
    raw = (params as Record<string, string | string[] | undefined>)[REFERRAL_PARAM];
  }

  const value = Array.isArray(raw) ? raw[0] : raw;
  return isValidReferralCode(value) ? value : null;
}

/**
 * Append a referral code to any path or absolute URL, preserving existing
 * query parameters. A `?r=` already present is overwritten.
 *
 *   appendReferralCode("/g/tapontap", "74392") -> "/g/tapontap?r=74392"
 *   appendReferralCode("https://zobia.org/u/joe?x=1", "74392")
 *     -> "https://zobia.org/u/joe?x=1&r=74392"
 */
export function appendReferralCode(url: string, code: string | null | undefined): string {
  if (!isValidReferralCode(code)) return url;

  // Handle absolute and relative URLs uniformly via a dummy base.
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
  const base = isAbsolute ? undefined : "https://placeholder.invalid";
  try {
    const parsed = new URL(url, base);
    parsed.searchParams.set(REFERRAL_PARAM, code);
    return isAbsolute
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    // Fallback for environments without a WHATWG URL implementation.
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}${REFERRAL_PARAM}=${encodeURIComponent(code)}`;
  }
}

/** Build the canonical "share my profile" referral link for a given origin. */
export function buildProfileReferralUrl(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/?${REFERRAL_PARAM}=${encodeURIComponent(code)}`;
}

/**
 * Build a shareable game link carrying the sharer's referral code.
 * Non-members who click it land on the public /g/<slug> cover page and the
 * `?r=` code is captured for signup attribution.
 *
 *   buildGameReferralUrl("https://zobia.org", "tetris", "74392")
 *     -> "https://zobia.org/g/tetris?r=74392"
 */
export function buildGameReferralUrl(
  origin: string,
  slug: string,
  code: string | null | undefined
): string {
  const base = `${origin.replace(/\/$/, "")}/g/${encodeURIComponent(slug)}`;
  return appendReferralCode(base, code);
}
