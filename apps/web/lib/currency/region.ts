/**
 * lib/currency/region.ts
 *
 * Resolves a signed-in user's effective country/currency and opportunistically
 * self-heals `users.country` for accounts that were silently defaulted to
 * "NG" at signup (every registration path before this fix) instead of never
 * being detected at all.
 *
 * Self-heal only fires when `country_source = 'default'` (never confirmed)
 * AND the current request carries a geo header that disagrees with the
 * stored value — a single, self-limiting write per user (source flips to
 * "geo" immediately after), not a write on every request.
 *
 * @module lib/currency/region
 */

import { db } from "@/lib/db";
import { getRequestCountry } from "@/lib/geo/country";
import { currencyForCountry, type CurrencyCode } from "@/lib/currency";

export interface UserRegion {
  country: string;
  isNigeria: boolean;
  currency: CurrencyCode;
}

interface UserCountryRow {
  country: string | null;
  country_source: string;
  currency_preference: string | null;
}

/**
 * @param req Optional — pass the incoming request to enable geo self-heal
 *            and to fall back to live IP-geolocation for a still-unconfirmed
 *            account instead of the stale "NG" default.
 */
export async function getUserRegion(userId: string, req?: Request): Promise<UserRegion> {
  const { rows } = await db.query<UserCountryRow>(
    `SELECT country, country_source, currency_preference FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  const requestCountry = req ? getRequestCountry(req) : null;

  let country = row?.country ?? "NG";
  const source = row?.country_source ?? "default";

  if (source === "default" && requestCountry) {
    country = requestCountry;
    // Fire-and-forget — never block the response on this write.
    db.query(
      `UPDATE users SET country = $1, country_source = 'geo' WHERE id = $2 AND country_source = 'default'`,
      [requestCountry, userId]
    ).catch(() => {});
  }

  const preference = row?.currency_preference;
  const currency: CurrencyCode =
    preference === "NGN" || preference === "USD" ? preference : currencyForCountry(country);

  return { country, isNigeria: country === "NG", currency };
}
