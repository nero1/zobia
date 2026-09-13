/**
 * lib/payments/contextSettings.ts
 *
 * Per payment-context (business tier, subscription, coins, stars, merch)
 * independent Paystack / crypto-currency / free toggles — backs the admin
 * gate44/payments page and every checkout flow's "what can I show this
 * user" check.
 *
 * @module lib/payments/contextSettings
 */

import { db } from "@/lib/db";
import type { CryptoCurrency } from "@zobia/types";

export const PAYMENT_CONTEXT_KEYS = [
  "business_tier",
  "business_renew",
  "subscription",
  "coin_purchase",
  "star_purchase",
  "merch_purchase",
] as const;

export type PaymentContextKey = (typeof PAYMENT_CONTEXT_KEYS)[number];

export const PAYMENT_CONTEXT_LABELS: Record<PaymentContextKey, string> = {
  business_tier: "Business tier upgrade",
  business_renew: "Business account renewal",
  subscription: "Plus/Pro/Max subscription",
  coin_purchase: "Coin pack purchase",
  star_purchase: "Star pack purchase",
  merch_purchase: "Creator merch purchase",
};

export interface PaymentContextSettings {
  contextKey: PaymentContextKey;
  paystackEnabled: boolean;
  cryptoEnabledCurrencies: CryptoCurrency[];
  isFree: boolean;
  updatedAt: string | null;
}

interface Row {
  context_key: string;
  paystack_enabled: boolean;
  crypto_enabled_currencies: CryptoCurrency[];
  is_free: boolean;
  updated_at: string | null;
}

function rowToSettings(row: Row): PaymentContextSettings {
  return {
    contextKey: row.context_key as PaymentContextKey,
    paystackEnabled: row.paystack_enabled,
    cryptoEnabledCurrencies: Array.isArray(row.crypto_enabled_currencies) ? row.crypto_enabled_currencies : [],
    isFree: row.is_free,
    updatedAt: row.updated_at,
  };
}

const DEFAULTS: PaymentContextSettings = {
  contextKey: "business_tier",
  paystackEnabled: true,
  cryptoEnabledCurrencies: [],
  isFree: false,
  updatedAt: null,
};

export async function getPaymentContextSettings(contextKey: PaymentContextKey): Promise<PaymentContextSettings> {
  const { rows } = await db.query<Row>(
    `SELECT context_key, paystack_enabled, crypto_enabled_currencies, is_free, updated_at
     FROM payment_context_settings WHERE context_key = $1 LIMIT 1`,
    [contextKey]
  );
  if (!rows[0]) return { ...DEFAULTS, contextKey };
  return rowToSettings(rows[0]);
}

export async function getAllPaymentContextSettings(): Promise<PaymentContextSettings[]> {
  const { rows } = await db.query<Row>(
    `SELECT context_key, paystack_enabled, crypto_enabled_currencies, is_free, updated_at
     FROM payment_context_settings ORDER BY context_key ASC`
  );
  const byKey = new Map(rows.map((r) => [r.context_key, rowToSettings(r)]));
  return PAYMENT_CONTEXT_KEYS.map((key) => byKey.get(key) ?? { ...DEFAULTS, contextKey: key });
}

export async function updatePaymentContextSettings(
  contextKey: PaymentContextKey,
  patch: Partial<Pick<PaymentContextSettings, "paystackEnabled" | "cryptoEnabledCurrencies" | "isFree">>,
  updatedBy: string
): Promise<void> {
  const current = await getPaymentContextSettings(contextKey);
  const next = {
    ...current,
    paystackEnabled: patch.paystackEnabled ?? current.paystackEnabled,
    cryptoEnabledCurrencies: patch.cryptoEnabledCurrencies ?? current.cryptoEnabledCurrencies,
    isFree: patch.isFree ?? current.isFree,
  };
  await db.query(
    `INSERT INTO payment_context_settings (context_key, paystack_enabled, crypto_enabled_currencies, is_free, updated_by, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
     ON CONFLICT (context_key) DO UPDATE
       SET paystack_enabled = EXCLUDED.paystack_enabled,
           crypto_enabled_currencies = EXCLUDED.crypto_enabled_currencies,
           is_free = EXCLUDED.is_free,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
    [contextKey, next.paystackEnabled, JSON.stringify(next.cryptoEnabledCurrencies), next.isFree, updatedBy]
  );
}

/** "Make all payments free" — sets is_free = true for every payment context.
 *  Shared by both Danger Zone entry points (gate44/settings and
 *  gate44/payments) — see those pages' UI comments. */
export async function makeAllPaymentsFree(updatedBy: string): Promise<void> {
  await db.query(
    `UPDATE payment_context_settings SET is_free = true, updated_by = $1, updated_at = NOW()`,
    [updatedBy]
  );
}
