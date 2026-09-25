/**
 * lib/payments/crypto/index.ts
 *
 * Crypto payment provider — user connects their own wallet and sends the
 * transaction themselves (no processor, no inbound webhook). The flow:
 *
 *   1. `initializePayment()` computes the exact token amount required
 *      (from the live/manual price feed + any admin discount) and returns
 *      the platform's receiving address for the chosen chain. A `payments`
 *      row is created in `pending` status.
 *   2. The client shows a wallet-connect UI, the user approves and sends
 *      the transaction, and the client submits the resulting tx hash to
 *      `submitTransactionHash()`.
 *   3. `verifyPayment()` polls the chain adapter for that tx hash and
 *      confirms it pays >= the expected amount to the expected address —
 *      NEVER trusting the client-submitted amount, only the hash.
 *   4. The daily CRON reconciliation pass (see
 *      app/api/cron/daily-platform/route.ts) re-verifies any payment still
 *      `pending` past a short timeout, as a safety net — the primary
 *      confirmation path is the client polling a status endpoint every few
 *      seconds while the user waits on the confirmation screen.
 *
 * Implements the same `PaymentProviderModule` shape as paystack.ts so the
 * registry in lib/payments/index.ts can dispatch to it identically.
 *
 * @module lib/payments/crypto
 */

import { randomUUID } from "crypto";
import Decimal from "decimal.js";
import { and, eq, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { logger } from "@/lib/logger";
import { cryptoRpcBreaker } from "@/lib/payments/circuit";
import type {
  PaymentInitResult,
  PaymentVerifyResult,
  PaymentProviderModule,
} from "@/lib/payments/types";
import type { CryptoCurrency } from "@zobia/types";
import { getToken } from "./tokens";
import { getUsdPrice } from "./priceFeed";
import { getCryptoDiscountPercent, getUsdToNgnRate } from "./settings";
import { getChainAdapter, MIN_CONFIRMATIONS } from "./chains";

export class CryptoConfigError extends Error {}
export class InsufficientAmountError extends Error {}

/** How long a pending crypto payment stays eligible for retry-verification
 *  before the reconciliation pass gives up and marks it failed. */
export const PENDING_PAYMENT_RECONCILE_HOURS = 48;

function receivingAddressFor(chain: "bsc" | "solana"): string {
  const address =
    chain === "bsc" ? process.env.CRYPTO_RECEIVING_ADDRESS_BSC : process.env.CRYPTO_RECEIVING_ADDRESS_SOLANA;
  if (!address) {
    throw new CryptoConfigError(
      `[crypto] CRYPTO_RECEIVING_ADDRESS_${chain === "bsc" ? "BSC" : "SOLANA"} is not configured`
    );
  }
  return address;
}

export interface ComputedAmount {
  currency: CryptoCurrency;
  chain: "bsc" | "solana";
  receivingAddress: string;
  tokenContract: string | null;
  decimals: number;
  /** Exact base-unit amount (wei / lamports) the user must send. */
  expectedBaseUnits: bigint;
  /** Human-readable token amount (e.g. "12.345678"). */
  expectedDisplayAmount: string;
  discountPercent: number;
  usdEquivalent: string;
  discountedUsdEquivalent: string;
  priceSource: "manual" | "live" | "stale-cache";
  tokenUsdPrice: string;
}

/**
 * Compute the exact token amount required for a given NGN-kobo price,
 * applying the currency's admin-configured discount. Always recomputed
 * server-side — never trust a client-submitted amount.
 */
export async function computeExpectedAmount(
  amountKobo: number,
  currency: CryptoCurrency
): Promise<ComputedAmount> {
  const token = getToken(currency);
  const [price, discountPercent, usdToNgn] = await Promise.all([
    getUsdPrice(currency),
    getCryptoDiscountPercent(currency),
    getUsdToNgnRate(),
  ]);

  const usdEquivalent = new Decimal(amountKobo).div(100).div(usdToNgn);
  const discountedUsd = usdEquivalent.mul(new Decimal(100).minus(discountPercent).div(100));
  const tokenAmount = discountedUsd.div(price.usdPrice);
  const expectedBaseUnits = BigInt(
    tokenAmount.mul(new Decimal(10).pow(token.decimals)).toFixed(0, Decimal.ROUND_UP)
  );

  return {
    currency,
    chain: token.chain,
    receivingAddress: receivingAddressFor(token.chain),
    tokenContract: token.contractAddress,
    decimals: token.decimals,
    expectedBaseUnits,
    expectedDisplayAmount: tokenAmount.toFixed(token.decimals > 8 ? 8 : token.decimals),
    discountPercent,
    usdEquivalent: usdEquivalent.toFixed(2),
    discountedUsdEquivalent: discountedUsd.toFixed(2),
    priceSource: price.source,
    tokenUsdPrice: price.usdPrice.toString(),
  };
}

/** JSON-safe wire form of {@link ComputedAmount} — `expectedBaseUnits` is a
 *  `bigint`, which `NextResponse.json()` cannot serialize (it throws
 *  "Do not know how to serialize a BigInt"). Every route that returns a
 *  computed crypto amount to the client MUST pass it through this first. */
export interface SerializedComputedAmount extends Omit<ComputedAmount, "expectedBaseUnits"> {
  expectedBaseUnits: string;
}

export function serializeComputedAmount(computed: ComputedAmount): SerializedComputedAmount {
  return { ...computed, expectedBaseUnits: computed.expectedBaseUnits.toString() };
}

// ---------------------------------------------------------------------------
// PaymentProviderModule implementation
// ---------------------------------------------------------------------------

async function initializePayment(
  amountSmallestUnit: number,
  _currency: string,
  _email: string,
  idempotencyKey: string,
  metadata: Record<string, unknown>,
  _returnUrl: string
): Promise<PaymentInitResult> {
  const cryptoCurrency = metadata.cryptoCurrency as CryptoCurrency | undefined;
  if (!cryptoCurrency) {
    throw new CryptoConfigError("[crypto] initializePayment requires metadata.cryptoCurrency");
  }
  const computed = await computeExpectedAmount(amountSmallestUnit, cryptoCurrency);

  return {
    paymentUrl: "", // crypto has no redirect checkout — client drives the wallet flow
    providerReference: idempotencyKey,
    raw: computed,
  };
}

export async function verifyPayment(providerReference: string): Promise<PaymentVerifyResult> {
  const orm = await getDb();
  const rows = await orm
    .select({
      id: schema.payments.id,
      chain: schema.payments.chain,
      tokenSymbol: schema.payments.tokenSymbol,
      txHash: schema.payments.txHash,
      expectedTokenAmount: schema.payments.expectedTokenAmount,
      currency: schema.payments.currency,
      amountKobo: schema.payments.amountKobo,
    })
    .from(schema.payments)
    .where(
      and(
        or(eq(schema.payments.providerReference, providerReference), eq(schema.payments.idempotencyKey, providerReference)),
        eq(schema.payments.provider, "crypto")
      )
    )
    .limit(1);
  const payment = rows[0];
  if (!payment) {
    return { success: false, providerReference, amountSmallestUnit: 0, currency: "NGN", raw: null };
  }
  if (!payment.txHash || !payment.chain || !payment.tokenSymbol || !payment.expectedTokenAmount) {
    return {
      success: false,
      pending: true,
      providerReference,
      amountSmallestUnit: Number(payment.amountKobo),
      currency: payment.currency,
      raw: { reason: "awaiting_tx_hash" },
    };
  }

  const chain = payment.chain as "bsc" | "solana";
  const adapter = getChainAdapter(chain);
  const token = getToken(payment.tokenSymbol as CryptoCurrency);
  const receivingAddress = receivingAddressFor(chain);

  const transfer = await cryptoRpcBreaker.execute(() =>
    adapter.getTransfer(payment.txHash as string, receivingAddress, token.contractAddress)
  );

  if (transfer.status === "not_found" || transfer.status === "pending") {
    return {
      success: false,
      pending: true,
      providerReference,
      amountSmallestUnit: Number(payment.amountKobo),
      currency: payment.currency,
      raw: transfer,
    };
  }
  if (transfer.status === "failed") {
    return {
      success: false,
      providerReference,
      amountSmallestUnit: Number(payment.amountKobo),
      currency: payment.currency,
      raw: transfer,
    };
  }

  const expected = BigInt(payment.expectedTokenAmount);
  if (transfer.valueBaseUnits < expected) {
    logger.warn(
      { providerReference, expected: expected.toString(), got: transfer.valueBaseUnits.toString() },
      "[crypto] Underpaid transaction"
    );
    return {
      success: false,
      providerReference,
      amountSmallestUnit: Number(payment.amountKobo),
      currency: payment.currency,
      raw: { ...transfer, reason: "underpaid" },
    };
  }

  const minConfirmations = MIN_CONFIRMATIONS[chain];
  if (transfer.confirmations < minConfirmations) {
    return {
      success: false,
      pending: true,
      providerReference,
      amountSmallestUnit: Number(payment.amountKobo),
      currency: payment.currency,
      raw: transfer,
    };
  }

  return {
    success: true,
    providerReference,
    amountSmallestUnit: Number(payment.amountKobo),
    currency: payment.currency,
    raw: transfer,
  };
}

async function validateWebhook(): Promise<boolean> {
  // Crypto has no inbound webhook — payments are confirmed by polling the
  // chain, never by trusting an inbound HTTP callback.
  return false;
}

async function createPayout(): Promise<never> {
  throw new Error(
    "[crypto] Automated crypto payouts are not supported — creator crypto payouts are always processed manually by an admin (see app/api/creator/payouts/route.ts)."
  );
}

export const cryptoProvider: PaymentProviderModule = {
  initializePayment,
  verifyPayment,
  validateWebhook,
  createPayout,
};

// ---------------------------------------------------------------------------
// Payment-row lifecycle helpers used by the dedicated crypto API routes
// (app/api/economy/crypto/*) — these go beyond the generic
// PaymentProviderModule shape because the crypto flow is inherently
// multi-step and client-driven (connect wallet → send → submit hash).
// ---------------------------------------------------------------------------

export async function createPendingCryptoPayment(params: {
  userId: string;
  paymentType: string;
  amountKobo: number;
  currency: CryptoCurrency;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ paymentId: string; idempotencyKey: string; computed: ComputedAmount }> {
  const computed = await computeExpectedAmount(params.amountKobo, params.currency);
  const idempotencyKey = `crypto:${params.userId}:${randomUUID()}`;

  const orm = await getDb();
  const rows = await orm
    .insert(schema.payments)
    .values({
      userId: params.userId,
      paymentType: params.paymentType,
      amountKobo: BigInt(params.amountKobo),
      currency: "NGN",
      provider: "crypto",
      status: "pending",
      idempotencyKey,
      referenceId: params.referenceId ?? null,
      metadata: params.metadata ?? {},
      chain: computed.chain,
      tokenSymbol: computed.currency,
      walletAddress: computed.receivingAddress,
      expectedTokenAmount: computed.expectedBaseUnits.toString(),
    })
    .returning({ id: schema.payments.id });
  return { paymentId: rows[0].id, idempotencyKey, computed };
}

/**
 * Stamp the computed chain/token/amount details from `initializePayment`'s
 * `raw` result onto an already-inserted `payments` row. Used by call sites
 * that insert their own `payments` row before calling the router (coins,
 * stars, subscriptions, business tier/renew) — mirrors how they stamp the
 * paystack payment_url/reference onto the same row.
 */
export async function applyCryptoComputedAmount(paymentId: string, raw: unknown): Promise<void> {
  const computed = raw as ComputedAmount;
  const orm = await getDb();
  await orm
    .update(schema.payments)
    .set({
      chain: computed.chain,
      tokenSymbol: computed.currency,
      walletAddress: computed.receivingAddress,
      expectedTokenAmount: computed.expectedBaseUnits.toString(),
      updatedAt: new Date(),
    })
    .where(eq(schema.payments.id, paymentId));
}

export async function submitTransactionHash(params: {
  userId: string;
  idempotencyKey: string;
  txHash: string;
  senderAddress: string;
}): Promise<void> {
  const orm = await getDb();
  const rows = await orm
    .select({ id: schema.payments.id, status: schema.payments.status })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.idempotencyKey, params.idempotencyKey),
        eq(schema.payments.userId, params.userId),
        eq(schema.payments.provider, "crypto")
      )
    )
    .limit(1);
  const payment = rows[0];
  if (!payment) throw new Error("[crypto] Payment not found for this reference");
  if (payment.status !== "pending") throw new Error(`[crypto] Payment is already ${payment.status}`);

  await orm
    .update(schema.payments)
    .set({
      txHash: params.txHash,
      providerTransactionId: params.txHash,
      walletAddress: params.senderAddress,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.payments.id, payment.id), isNull(schema.payments.txHash)));
}
