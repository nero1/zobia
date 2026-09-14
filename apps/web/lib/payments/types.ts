/**
 * lib/payments/types.ts
 *
 * Common `PaymentProvider` interface every payment integration module
 * implements, plus the registry type used by `lib/payments/index.ts`.
 *
 * Adding a new payment provider means:
 *   1. Create `lib/payments/<name>.ts` (or `lib/payments/<name>/index.ts`)
 *      implementing `PaymentProviderModule`.
 *   2. Add one entry to the `PROVIDER_REGISTRY` map in `lib/payments/index.ts`.
 * No other call site should ever need to change.
 *
 * @module lib/payments/types
 */

/** Provider-agnostic payment initiation result. */
export interface PaymentInitResult {
  /** URL to redirect / open for the user to complete checkout. Empty string
   *  for flows (like crypto) that are driven entirely client-side instead of
   *  a redirect. */
  paymentUrl: string;
  /** Unique provider-assigned reference for this payment. */
  providerReference: string;
  /** Raw provider-specific response (for persistence). */
  raw: unknown;
}

/** Provider-agnostic payment verification result. */
export interface PaymentVerifyResult {
  /** Whether the payment completed successfully. */
  success: boolean;
  /** True while the payment is still awaiting confirmation (e.g. an on-chain
   *  transaction that hasn't reached the required number of confirmations
   *  yet). `success` is false in this case — callers should keep polling. */
  pending?: boolean;
  /** Provider-assigned payment reference. */
  providerReference: string;
  /** Amount verified, in the smallest currency unit (kobo for NGN, cents for
   *  USD, base units for crypto amounts expressed in NGN-equivalent kobo). */
  amountSmallestUnit: number;
  /** ISO 4217 currency code, or the crypto token symbol. */
  currency: string;
  /** Raw provider response (for logging). */
  raw: unknown;
}

/** Provider-agnostic payout result. */
export interface PayoutResult {
  /** Provider-assigned payout / transfer ID. */
  providerId: string;
  /** Current status of the payout. */
  status: string;
  /** Raw provider response. */
  raw: unknown;
}

/**
 * Every payment provider module must export functions matching this shape
 * (as named exports — this interface documents the contract; TypeScript
 * structural typing checks each module against it in the registry).
 */
export interface PaymentProviderModule {
  initializePayment(
    amountSmallestUnit: number,
    currency: string,
    email: string,
    idempotencyKey: string,
    metadata: Record<string, unknown>,
    returnUrl: string
  ): Promise<PaymentInitResult>;

  verifyPayment(providerReference: string): Promise<PaymentVerifyResult>;

  /** Validate an inbound webhook / confirmation signal. Providers with no
   *  webhook concept (e.g. crypto, which is verified by polling the chain)
   *  may implement this as a no-op that always returns false — callers
   *  should not rely on webhooks for those providers. */
  validateWebhook(rawBody: Buffer | string, signatureHeader: string): Promise<boolean>;

  createPayout?(
    amountSmallestUnit: number,
    currency: string,
    recipientDetails: Record<string, unknown>,
    reference: string
  ): Promise<PayoutResult>;
}

export type ProviderName = "paystack" | "crypto";
