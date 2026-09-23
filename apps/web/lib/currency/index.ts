/**
 * lib/currency/index.ts
 *
 * Fiat display-currency abstraction.
 *
 * Every monetary amount in the DB stays kobo-denominated (NGN smallest
 * unit) — this module never changes storage, only what a given user is
 * SHOWN. Nigerian users (country === "NG") see Naira; everyone else sees a
 * USD-equivalent computed with the same admin-configurable USD/NGN rate the
 * crypto checkout already uses (lib/payments/crypto/settings.ts), so the
 * two surfaces never disagree with each other.
 *
 * This intentionally does NOT change which payment provider a user can pay
 * with — that is (and already was) gated separately by
 * lib/payments/contextSettings.ts's `getUserIsNigeria`. This module only
 * fixes what a user *sees*: no non-Nigerian should ever be shown a Naira
 * price when they cannot pay in Naira.
 *
 * @module lib/currency
 */

import Decimal from "decimal.js";
import { getUsdToNgnRate } from "@/lib/payments/crypto/settings";

export type CurrencyCode = "NGN" | "USD";

export const DEFAULT_CURRENCY: CurrencyCode = "USD";

/** Nigeria pays/sees Naira. Every other (or unknown) country sees USD —
 *  the inverse of the old bug, which silently showed Naira to everyone. */
export function currencyForCountry(country: string | null | undefined): CurrencyCode {
  return country === "NG" ? "NGN" : "USD";
}

/** Convert a kobo (NGN smallest-unit) amount into the given display
 *  currency's major unit, as a Decimal (never a float) for exact rounding. */
export async function koboToMajorUnit(
  amountKobo: number | bigint | string,
  currency: CurrencyCode
): Promise<Decimal> {
  const ngnMajor = new Decimal(amountKobo.toString()).div(100);
  if (currency === "NGN") return ngnMajor;
  const rate = await getUsdToNgnRate();
  return ngnMajor.div(rate);
}

const FORMATTERS: Record<CurrencyCode, Intl.NumberFormat> = {
  NGN: new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }),
  USD: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }),
};

/** Format a kobo amount for display in the given currency, e.g. "₦1,200" or "$3.45". */
export async function formatKobo(
  amountKobo: number | bigint | string,
  currency: CurrencyCode
): Promise<string> {
  const major = await koboToMajorUnit(amountKobo, currency);
  return FORMATTERS[currency].format(major.toNumber());
}

/** Synchronous formatter for when the major-unit amount (and rate, if any
 *  conversion already happened) is already known — used by client components
 *  that received a pre-converted number from an API response. */
export function formatMajorUnit(amountMajor: number, currency: CurrencyCode): string {
  return FORMATTERS[currency].format(amountMajor);
}

export const CURRENCY_SYMBOL: Record<CurrencyCode, string> = { NGN: "₦", USD: "$" };
