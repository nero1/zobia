/**
 * lib/payments/index.ts
 *
 * Unified payment provider router.
 *
 * Reads the active provider from the x_manifest (`payment.primaryProvider`)
 * and delegates every call to the corresponding integration module through
 * a small registry. All consumer code should import from this file — never
 * from a provider module directly — so that swapping providers, or adding a
 * new one, requires no call-site changes.
 *
 * Adding provider #4: implement `PaymentProviderModule` (see
 * lib/payments/types.ts) in its own file/subtree, then add one entry to
 * `PROVIDER_REGISTRY` below.
 *
 * Supported providers:
 *   - "paystack" → Nigerian web / PWA flows
 *   - "crypto"   → global / international flows (user-initiated on-chain
 *                  transfer of JAGA / BNB / SOL — see lib/payments/crypto/)
 *   - "none"     → Payments disabled; all calls throw
 *
 * @module lib/payments
 */

import { loadManifest } from "@/lib/manifest";
import type { PaymentProviderModule, PaymentInitResult, PaymentVerifyResult, PayoutResult, ProviderName } from "./types";

export type { PaymentInitResult, PaymentVerifyResult, PayoutResult };

// ---------------------------------------------------------------------------
// Registry — lazily imported so an unused provider's SDK/deps never load
// ---------------------------------------------------------------------------

const PROVIDER_REGISTRY: Record<ProviderName, () => Promise<PaymentProviderModule>> = {
  paystack: async () => {
    const mod = await import("./paystack");
    return {
      initializePayment: async (amount, currency, email, idempotencyKey, metadata, returnUrl) => {
        const result = await mod.initializePayment(amount, email, idempotencyKey, metadata, returnUrl);
        return { paymentUrl: result.authorization_url, providerReference: result.reference, raw: result };
      },
      verifyPayment: async (providerReference) => {
        const result = await mod.verifyPayment(providerReference);
        return {
          success: result.status === "success",
          providerReference: result.reference,
          amountSmallestUnit: result.amount,
          currency: result.currency,
          raw: result,
        };
      },
      validateWebhook: async (rawBody, signatureHeader) => mod.verifyWebhookSignature(rawBody, signatureHeader),
      createPayout: async (amount, _currency, recipientDetails, reference) => {
        const recipientCode = recipientDetails.recipientCode as string;
        const reason = (recipientDetails.reason as string) ?? "Creator payout";
        const result = await mod.initiateTransfer(amount, recipientCode, reference, reason);
        return { providerId: result.transfer_code, status: result.status, raw: result };
      },
    };
  },
  crypto: async () => {
    const mod = await import("./crypto");
    return mod.cryptoProvider;
  },
};

async function getActiveProvider(): Promise<ProviderName | "none"> {
  const manifest = await loadManifest();
  return manifest.payment.primaryProvider;
}

async function resolveProvider(override?: ProviderName): Promise<PaymentProviderModule> {
  const name = override ?? (await getActiveProvider());
  if (name === "none") {
    throw new Error("[payments] Payment provider is set to 'none' — payments are disabled");
  }
  const factory = PROVIDER_REGISTRY[name];
  if (!factory) throw new Error(`[payments] Unknown provider: ${name}`);
  return factory();
}

// ---------------------------------------------------------------------------
// Exported unified interface
// ---------------------------------------------------------------------------

/**
 * Initialize a payment with the active provider (or `providerOverride`).
 *
 * @param amountSmallestUnit - Amount in smallest currency unit (kobo / cents)
 * @param currency           - ISO 4217 currency code (e.g. "NGN", "USD")
 * @param email              - Customer email
 * @param idempotencyKey     - Unique key to prevent duplicate charges
 * @param metadata           - Arbitrary metadata to attach to the payment.
 *                              For the crypto provider, must include
 *                              `cryptoCurrency` ("JAGA" | "BNB" | "SOL").
 * @param returnUrl          - URL to redirect after payment (ignored by crypto)
 * @param providerOverride   - Explicitly select a provider instead of reading from the manifest
 */
export async function initializePayment(
  amountSmallestUnit: number,
  currency: string,
  email: string,
  idempotencyKey: string,
  metadata: Record<string, unknown>,
  returnUrl: string,
  providerOverride?: ProviderName
): Promise<PaymentInitResult> {
  const provider = await resolveProvider(providerOverride);
  return provider.initializePayment(amountSmallestUnit, currency, email, idempotencyKey, metadata, returnUrl);
}

/**
 * Verify a payment with the active provider.
 *
 * @param providerReference - The reference/ID returned at payment initiation
 */
export async function verifyPayment(providerReference: string, providerOverride?: ProviderName): Promise<PaymentVerifyResult> {
  const provider = await resolveProvider(providerOverride);
  return provider.verifyPayment(providerReference);
}

/**
 * Validate a webhook signature for the active provider.
 *
 * Pass the raw request body bytes and the provider's signature header.
 * Returns false (rather than throwing) so webhook handlers can respond 401.
 * Providers with no webhook concept (crypto) always return false.
 */
export async function validateWebhook(rawBody: Buffer | string, signatureHeader: string): Promise<boolean> {
  try {
    const provider = await resolveProvider();
    return await provider.validateWebhook(rawBody, signatureHeader);
  } catch {
    return false;
  }
}

/**
 * Initiate a creator payout with the active provider.
 *
 * @throws If payments are disabled, the provider doesn't support payouts, or the provider fails
 */
export async function createPayout(
  amountSmallestUnit: number,
  currency: string,
  recipientDetails: Record<string, unknown>,
  reference: string,
  providerOverride?: ProviderName
): Promise<PayoutResult> {
  const provider = await resolveProvider(providerOverride);
  if (!provider.createPayout) {
    throw new Error(`[payments] Active provider does not support automated payouts`);
  }
  return provider.createPayout(amountSmallestUnit, currency, recipientDetails, reference);
}
