/**
 * lib/payments/crypto/settings.ts
 *
 * Admin-configurable crypto checkout settings: per-currency discount
 * percentage and the USD→NGN display rate. Both live in x_manifest,
 * matching how the rest of the app stores admin-editable numeric knobs
 * (see lib/business/limits.ts).
 *
 * @module lib/payments/crypto/settings
 */

import Decimal from "decimal.js";
import { getManifestValue } from "@/lib/manifest";
import type { CryptoCurrency } from "@zobia/types";
import { SUPPORTED_CURRENCIES } from "./tokens";

const DEFAULT_DISCOUNTS: Record<CryptoCurrency, number> = { JAGA: 20, BNB: 0, SOL: 0 };
const DEFAULT_USD_TO_NGN = 1600;

/** Percentage discount (0-90) applied at checkout when paying with `symbol`. */
export async function getCryptoDiscountPercent(symbol: CryptoCurrency): Promise<number> {
  const raw = await getManifestValue("payment_crypto_discounts");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<CryptoCurrency, number>>;
      const value = parsed[symbol];
      if (typeof value === "number" && value >= 0 && value <= 90) return value;
    } catch {
      // fall through to default
    }
  }
  return DEFAULT_DISCOUNTS[symbol] ?? 0;
}

export async function getAllCryptoDiscounts(): Promise<Record<CryptoCurrency, number>> {
  const entries = await Promise.all(
    SUPPORTED_CURRENCIES.map(async (symbol) => [symbol, await getCryptoDiscountPercent(symbol)] as const)
  );
  return Object.fromEntries(entries) as Record<CryptoCurrency, number>;
}

/** Display-only USD→NGN rate — core pricing stays kobo-denominated; this is
 *  used only to show a crypto-equivalent price in Naira for context. */
export async function getUsdToNgnRate(): Promise<Decimal> {
  const raw = await getManifestValue("payment_usd_to_ngn_rate");
  const parsed = raw != null ? new Decimal(raw) : null;
  if (parsed && parsed.isPositive()) return parsed;
  return new Decimal(DEFAULT_USD_TO_NGN);
}
