/**
 * lib/payments/crypto/payouts.ts
 *
 * Crypto-native commission/earnings ledger — kept entirely separate from
 * the NGN-kobo coin ledger so a creator or referrer who earns in JAGA/BNB/SOL
 * is paid back in the same currency they earned, with no cross-currency
 * exchange-rate reconciliation. Admin controls (all in x_manifest):
 *
 *   crypto_payouts_enabled       — off by default. While off, every crypto-
 *                                   sourced commission/earning still converts
 *                                   to Credits exactly as before this feature.
 *   crypto_payout_mode           — "crypto" | "credits". Even with payouts
 *                                   enabled, admin may prefer to always
 *                                   settle in Credits (default) rather than
 *                                   have users hold on-platform crypto
 *                                   balances.
 *   crypto_payout_threshold_<SYM> — minimum base-unit balance before a
 *                                   withdrawal request is allowed.
 *
 * All arithmetic is Decimal.js — this money must never touch IEEE 754 floats.
 */

import Decimal from "decimal.js";
import type { TransactionClient } from "@/lib/db/interface";
import { getManifestValue } from "@/lib/manifest";
import { getToken } from "./tokens";
import { getUsdPrice } from "./priceFeed";
import type { CryptoCurrency } from "@zobia/types";

export type CryptoPayoutMode = "crypto" | "credits";

const DEFAULT_THRESHOLDS_USD: Record<CryptoCurrency, number> = { JAGA: 10, BNB: 10, SOL: 10 };

export async function getCryptoPayoutsEnabled(): Promise<boolean> {
  const raw = await getManifestValue("crypto_payouts_enabled");
  return raw === "true" || raw === "1";
}

export async function getCryptoPayoutMode(): Promise<CryptoPayoutMode> {
  const raw = await getManifestValue("crypto_payout_mode");
  return raw === "crypto" ? "crypto" : "credits";
}

/** Minimum base-unit balance required before a withdrawal is allowed, for
 *  the given currency — admin-configurable per currency, defaulting to a
 *  ~$10 equivalent computed from the live token price. */
export async function getCryptoPayoutThreshold(currency: CryptoCurrency): Promise<bigint> {
  const raw = await getManifestValue(`crypto_payout_threshold_${currency}`);
  if (raw != null) {
    try {
      const parsed = BigInt(raw);
      if (parsed >= 0n) return parsed;
    } catch {
      // fall through to computed default
    }
  }
  const token = getToken(currency);
  const price = await getUsdPrice(currency);
  const tokenAmount = new Decimal(DEFAULT_THRESHOLDS_USD[currency]).div(price.usdPrice);
  return BigInt(tokenAmount.mul(new Decimal(10).pow(token.decimals)).toFixed(0, Decimal.ROUND_UP));
}

/** Credit `baseUnitsAmount` of `currency` to a user's crypto balance ledger.
 *  Idempotent per (userId, currency, referenceId) via the unique index on
 *  crypto_balance_ledger — a retried webhook never double-credits. */
export async function creditCryptoBalance(
  tx: TransactionClient,
  userId: string,
  currency: CryptoCurrency,
  baseUnitsAmount: bigint,
  sourceType: string,
  referenceId: string,
  metadata: Record<string, unknown> = {}
): Promise<boolean> {
  if (baseUnitsAmount <= 0n) return false;

  const { rows: ledgerRows } = await tx.query<{ id: string }>(
    `INSERT INTO crypto_balance_ledger (user_id, currency, amount_base_units, source_type, reference_id, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
     ON CONFLICT (currency, reference_id) DO NOTHING
     RETURNING id`,
    [userId, currency, baseUnitsAmount.toString(), sourceType, referenceId, JSON.stringify(metadata)]
  );
  if (!ledgerRows[0]) return false; // already credited — idempotent no-op

  await tx.query(
    `INSERT INTO creator_crypto_balances (user_id, currency, balance_base_units, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, currency) DO UPDATE
       SET balance_base_units = creator_crypto_balances.balance_base_units + EXCLUDED.balance_base_units,
           updated_at = NOW()`,
    [userId, currency, baseUnitsAmount.toString()]
  );
  return true;
}

/** USD value (Decimal) of a base-unit crypto amount, using the live price feed. */
export async function cryptoBaseUnitsToUsd(currency: CryptoCurrency, baseUnitsAmount: bigint): Promise<Decimal> {
  const token = getToken(currency);
  const price = await getUsdPrice(currency);
  const tokenAmount = new Decimal(baseUnitsAmount.toString()).div(new Decimal(10).pow(token.decimals));
  return tokenAmount.mul(price.usdPrice);
}
