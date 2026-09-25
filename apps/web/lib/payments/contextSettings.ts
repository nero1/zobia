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

import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
  contextKey: string;
  paystackEnabled: boolean;
  cryptoEnabledCurrencies: unknown;
  isFree: boolean;
  updatedAt: Date | null;
}

function rowToSettings(row: Row): PaymentContextSettings {
  return {
    contextKey: row.contextKey as PaymentContextKey,
    paystackEnabled: row.paystackEnabled,
    cryptoEnabledCurrencies: Array.isArray(row.cryptoEnabledCurrencies)
      ? (row.cryptoEnabledCurrencies as CryptoCurrency[])
      : [],
    isFree: row.isFree,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
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
  const orm = await getDb();
  const rows = await orm
    .select()
    .from(schema.paymentContextSettings)
    .where(eq(schema.paymentContextSettings.contextKey, contextKey))
    .limit(1);
  if (!rows[0]) return { ...DEFAULTS, contextKey };
  return rowToSettings(rows[0]);
}

export async function getAllPaymentContextSettings(): Promise<PaymentContextSettings[]> {
  const orm = await getDb();
  const rows = await orm
    .select()
    .from(schema.paymentContextSettings)
    .orderBy(schema.paymentContextSettings.contextKey);
  const byKey = new Map(rows.map((r) => [r.contextKey, rowToSettings(r)]));
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
  const orm = await getDb();
  await orm
    .insert(schema.paymentContextSettings)
    .values({
      contextKey,
      paystackEnabled: next.paystackEnabled,
      cryptoEnabledCurrencies: next.cryptoEnabledCurrencies,
      isFree: next.isFree,
      updatedBy,
      updatedAt: sql`NOW()`,
    })
    .onConflictDoUpdate({
      target: schema.paymentContextSettings.contextKey,
      set: {
        paystackEnabled: next.paystackEnabled,
        cryptoEnabledCurrencies: next.cryptoEnabledCurrencies,
        isFree: next.isFree,
        updatedBy,
        updatedAt: sql`NOW()`,
      },
    });
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
  const orm = await getDb();
  const rows = await orm
    .select({ country: schema.users.country })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
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
  const orm = await getDb();
  await orm
    .update(schema.paymentContextSettings)
    .set({ isFree: true, updatedBy, updatedAt: sql`NOW()` });
}
