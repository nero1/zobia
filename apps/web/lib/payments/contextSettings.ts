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
import { badRequest } from "@/lib/api/errors";
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

/** Result of {@link enforcePaymentContext}: what the caller should actually
 *  do, having already validated the requested provider/currency against the
 *  admin-configured context settings server-side. */
export interface PaymentContextDecision {
  /** True when this context is currently free — the caller must bypass the
   *  payment provider entirely and grant the purchase immediately. */
  isFree: true;
  provider?: never;
  cryptoCurrency?: never;
}
export interface PaymentContextProviderDecision {
  isFree: false;
  provider: "paystack" | "crypto";
  cryptoCurrency?: CryptoCurrency;
}

/** Whether a user's stored country is Nigeria (defaults to true when unset,
 *  matching the rest of the codebase's Paystack-first assumption). */
export async function getUserIsNigeria(userId: string): Promise<boolean> {
  const { rows } = await db.query<{ country: string | null }>(
    `SELECT country FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  return (rows[0]?.country ?? "NG") === "NG";
}

/**
 * Server-side gate every purchase route MUST call before creating a payment
 * or granting anything for free. Re-derives what the client is allowed to do
 * from the DB — a client cannot bypass admin toggles by calling the API
 * directly with a disallowed provider/currency, because this function alone
 * decides what is actually permitted, never the request body.
 *
 * @param contextKey        - Which `payment_context_settings` row governs this purchase
 * @param isNigeria         - Whether the requesting user's country is Nigeria
 * @param requestedProvider - Provider the client asked for (untrusted)
 * @param requestedCurrency - Crypto currency the client asked for, if provider is crypto (untrusted)
 * @throws {ApiError} 400 if the requested provider/currency is not enabled for this context,
 *         or if the user's region has no enabled method at all (the "only Nigeria" case)
 */
export async function enforcePaymentContext(
  contextKey: PaymentContextKey,
  isNigeria: boolean,
  requestedProvider: "paystack" | "crypto" | undefined,
  requestedCurrency: CryptoCurrency | undefined
): Promise<PaymentContextDecision | PaymentContextProviderDecision> {
  const settings = await getPaymentContextSettings(contextKey);

  if (settings.isFree) {
    return { isFree: true };
  }

  const paystackAvailable = isNigeria && settings.paystackEnabled;
  const cryptoAvailable = settings.cryptoEnabledCurrencies.length > 0;

  if (!paystackAvailable && !cryptoAvailable) {
    throw badRequest(
      "Only Nigeria is supported for this at this time. We are working to add more countries.",
      "UNSUPPORTED_REGION"
    );
  }

  // Default to whichever method IS available when the client didn't ask,
  // preferring paystack for Nigerian users (matches existing manifest default).
  const provider = requestedProvider ?? (paystackAvailable ? "paystack" : "crypto");

  if (provider === "paystack") {
    if (!paystackAvailable) {
      throw badRequest(
        isNigeria
          ? "Paystack is not enabled for this purchase right now."
          : "Only Nigeria is supported for this at this time. We are working to add more countries.",
        isNigeria ? "PAYMENT_METHOD_DISABLED" : "UNSUPPORTED_REGION"
      );
    }
    return { isFree: false, provider: "paystack" };
  }

  // provider === "crypto"
  if (!requestedCurrency) {
    throw badRequest("cryptoCurrency is required when paymentProvider is 'crypto'", "MISSING_CRYPTO_CURRENCY");
  }
  if (!settings.cryptoEnabledCurrencies.includes(requestedCurrency)) {
    throw badRequest(
      `${requestedCurrency} is not enabled for this purchase right now.`,
      "PAYMENT_CURRENCY_DISABLED"
    );
  }
  return { isFree: false, provider: "crypto", cryptoCurrency: requestedCurrency };
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
