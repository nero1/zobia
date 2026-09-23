"use client";

/**
 * lib/hooks/useFiatCurrency.ts
 *
 * Client-side access to the signed-in user's resolved display currency
 * (NGN for Nigeria, USD everywhere else — see lib/currency/). Distinct
 * from useCurrency.ts, which only fetches the admin-configurable in-game
 * coin/star NAMES, not fiat.
 *
 * Cached for a full session (currency essentially never changes mid-session)
 * to keep this to one request per page load, not per component.
 */

import { useQuery } from "@tanstack/react-query";
import Decimal from "decimal.js";

export type CurrencyCode = "NGN" | "USD";

export interface FiatCurrency {
  currency: CurrencyCode;
  isNigeria: boolean;
  usdToNgnRate: string;
}

const DEFAULTS: FiatCurrency = { currency: "USD", isNigeria: false, usdToNgnRate: "1600" };

async function fetchFiatCurrency(): Promise<FiatCurrency> {
  try {
    const res = await fetch("/api/me/currency");
    if (!res.ok) return DEFAULTS;
    const json = await res.json();
    return json?.data ?? DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function useFiatCurrency() {
  return useQuery({
    queryKey: ["me", "currency"],
    queryFn: fetchFiatCurrency,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

const FORMATTERS: Record<CurrencyCode, Intl.NumberFormat> = {
  NGN: new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }),
  USD: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }),
};

/** Format a kobo (NGN smallest-unit) amount client-side, given an already-
 *  fetched FiatCurrency (from useFiatCurrency()). Never call before the
 *  query has resolved — pass `data` straight through, it has safe defaults. */
export function formatKoboClient(amountKobo: number | string, fiat: FiatCurrency): string {
  const ngnMajor = new Decimal(amountKobo).div(100);
  const major = fiat.currency === "NGN" ? ngnMajor : ngnMajor.div(fiat.usdToNgnRate);
  return FORMATTERS[fiat.currency].format(major.toNumber());
}
