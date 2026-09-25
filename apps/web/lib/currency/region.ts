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

import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { getRequestCountry } from "@/lib/geo/country";
import { currencyForCountry, type CurrencyCode } from "@/lib/currency";

export interface UserRegion {
  country: string;
  isNigeria: boolean;
  currency: CurrencyCode;
}

/**
 * @param req Optional — pass the incoming request to enable geo self-heal
 *            and to fall back to live IP-geolocation for a still-unconfirmed
 *            account instead of the stale "NG" default.
 */
export async function getUserRegion(userId: string, req?: Request): Promise<UserRegion> {
  const orm = await getDb();
  const rows = await orm
    .select({
      country: schema.users.country,
      countrySource: schema.users.countrySource,
      currencyPreference: schema.users.currencyPreference,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const row = rows[0];
  const requestCountry = req ? getRequestCountry(req) : null;

  let country = row?.country ?? "NG";
  const source = row?.countrySource ?? "default";

  if (source === "default" && requestCountry) {
    country = requestCountry;
    // Fire-and-forget — never block the response on this write.
    orm
      .update(schema.users)
      .set({ country: requestCountry, countrySource: "geo" })
      .where(and(eq(schema.users.id, userId), eq(schema.users.countrySource, "default")))
      .catch(() => {});
  }

  const preference = row?.currencyPreference;
  const currency: CurrencyCode =
    preference === "NGN" || preference === "USD" ? preference : currencyForCountry(country);

  return { country, isNigeria: country === "NG", currency };
}
