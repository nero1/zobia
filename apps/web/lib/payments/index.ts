/**
 * lib/payments/index.ts
 *
 * Unified payment provider router.
 *
 * Reads the active provider from the x_manifest (`payment.primaryProvider`)
 * and delegates every call to the corresponding integration module.
 * All consumer code should import from this file — never from a provider
 * module directly — so that swapping providers requires no call-site changes.
 *
 * Supported providers:
 *   - "paystack"      → Nigerian web / PWA flows
 *   - "dodopayments"  → International flows
 *   - "none"          → Payments disabled; all calls throw
 *
 * @module lib/payments
 */

import { loadManifest } from "@/lib/manifest";
import type { PaystackInitializeResponse, PaystackVerifyResponse } from "./paystack";
import type { DodoPaymentSession, DodoPaymentDetail, DodoPayout } from "./dodopayments";

// ---------------------------------------------------------------------------
// Unified return types
// ---------------------------------------------------------------------------

/**
 * Provider-agnostic payment initiation result.
 * The `paymentUrl` is always the URL to redirect / open for the user.
 */
export interface PaymentInitResult {
  /** URL to redirect the user to for checkout. */
  paymentUrl: string;
  /** Unique provider-assigned reference for this payment. */
  providerReference: string;
  /** Raw provider-specific response (for persistence). */
  raw: PaystackInitializeResponse | DodoPaymentSession;
}

/**
 * Provider-agnostic payment verification result.
 */
export interface PaymentVerifyResult {
  /** Whether the payment completed successfully. */
  success: boolean;
  /** Provider-assigned payment reference. */
  providerReference: string;
  /**
   * Amount verified, in the smallest currency unit.
   * Kobo for NGN, cents for USD, etc.
   */
  amountSmallestUnit: number;
  /** ISO 4217 currency code. */
  currency: string;
  /** Raw provider response (for logging). */
  raw: PaystackVerifyResponse | DodoPaymentDetail;
}

/**
 * Provider-agnostic payout result.
 */
export interface PayoutResult {
  /** Provider-assigned payout / transfer ID. */
  providerId: string;
  /** Current status of the payout. */
  status: string;
  /** Raw provider response. */
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Internal: lazy-load the active provider
// ---------------------------------------------------------------------------

type Provider = "paystack" | "dodopayments" | "none";

async function getActiveProvider(): Promise<Provider> {
  const manifest = await loadManifest();
  return manifest.payment.primaryProvider;
}

// ---------------------------------------------------------------------------
// Exported unified interface
// ---------------------------------------------------------------------------

/**
 * Initialize a payment with the active provider.
 *
 * Reads the active provider from the manifest and delegates to the
 * correct integration module.
 *
 * @param amountSmallestUnit - Amount in smallest currency unit (kobo / cents)
 * @param currency           - ISO 4217 currency code (e.g. "NGN", "USD")
 * @param email              - Customer email
 * @param idempotencyKey     - Unique key to prevent duplicate charges
 * @param metadata           - Arbitrary metadata to attach to the payment
 * @param returnUrl          - URL to redirect after payment (required for DodoPayments)
 * @returns Unified payment initiation result
 * @throws If payments are disabled or the provider fails
 */
export async function initializePayment(
  amountSmallestUnit: number,
  currency: string,
  email: string,
  idempotencyKey: string,
  metadata: Record<string, unknown>,
  returnUrl: string
): Promise<PaymentInitResult> {
  const provider = await getActiveProvider();

  if (provider === "paystack") {
    const { initializePayment: psInit } = await import("./paystack");
    const result = await psInit(amountSmallestUnit, email, idempotencyKey, metadata);
    return {
      paymentUrl: result.authorization_url,
      providerReference: result.reference,
      raw: result,
    };
  }

  if (provider === "dodopayments") {
    const { createPaymentSession } = await import("./dodopayments");
    const result = await createPaymentSession(
      amountSmallestUnit,
      currency,
      returnUrl,
      { ...metadata, idempotencyKey }
    );
    return {
      paymentUrl: result.payment_url,
      providerReference: result.id,
      raw: result,
    };
  }

  throw new Error("[payments] Payment provider is set to 'none' — payments are disabled");
}

/**
 * Verify a payment with the active provider.
 *
 * @param providerReference - The reference/ID returned at payment initiation
 * @returns Unified verification result
 * @throws If the provider is none or verification fails
 */
export async function verifyPayment(
  providerReference: string
): Promise<PaymentVerifyResult> {
  const provider = await getActiveProvider();

  if (provider === "paystack") {
    const { verifyPayment: psVerify } = await import("./paystack");
    const result = await psVerify(providerReference);
    return {
      success: result.status === "success",
      providerReference: result.reference,
      amountSmallestUnit: result.amount,
      currency: result.currency,
      raw: result,
    };
  }

  if (provider === "dodopayments") {
    const { verifyPayment: dodoVerify } = await import("./dodopayments");
    const result = await dodoVerify(providerReference);
    return {
      success: result.status === "succeeded",
      providerReference: result.id,
      amountSmallestUnit: result.amount,
      currency: result.currency,
      raw: result,
    };
  }

  throw new Error("[payments] Payment provider is set to 'none' — payments are disabled");
}

/**
 * Validate a webhook signature for the active provider.
 *
 * Pass the raw request body bytes and the provider's signature header.
 * Returns false (rather than throwing) so webhook handlers can respond 401.
 *
 * @param rawBody         - Raw request body buffer or string
 * @param signatureHeader - Provider-supplied signature header value
 * @returns true if the signature is valid
 */
export async function validateWebhook(
  rawBody: Buffer | string,
  signatureHeader: string
): Promise<boolean> {
  const provider = await getActiveProvider();

  if (provider === "paystack") {
    const { verifyWebhookSignature } = await import("./paystack");
    return verifyWebhookSignature(rawBody, signatureHeader);
  }

  if (provider === "dodopayments") {
    const { verifyWebhookSignature } = await import("./dodopayments");
    return verifyWebhookSignature(rawBody, signatureHeader);
  }

  return false;
}

/**
 * Initiate a creator payout with the active provider.
 *
 * @param amountSmallestUnit - Amount in smallest currency unit
 * @param currency           - ISO 4217 currency code
 * @param recipientDetails   - Provider-specific payout recipient details
 * @param reference          - Unique idempotency reference
 * @returns Unified payout result
 * @throws If payments are disabled or the provider fails
 */
export async function createPayout(
  amountSmallestUnit: number,
  currency: string,
  recipientDetails: Record<string, unknown>,
  reference: string
): Promise<PayoutResult> {
  const provider = await getActiveProvider();

  if (provider === "paystack") {
    const { initiateTransfer } = await import("./paystack");
    const recipientCode = recipientDetails.recipientCode as string;
    const reason = (recipientDetails.reason as string) ?? "Creator payout";
    const result = await initiateTransfer(
      amountSmallestUnit,
      recipientCode,
      reference,
      reason
    );
    return {
      providerId: result.transfer_code,
      status: result.status,
      raw: result,
    };
  }

  if (provider === "dodopayments") {
    const { initiatePayout } = await import("./dodopayments");
    const result = await initiatePayout(
      amountSmallestUnit,
      currency,
      recipientDetails,
      reference
    );
    return {
      providerId: result.id,
      status: result.status,
      raw: result,
    };
  }

  throw new Error("[payments] Payment provider is set to 'none' — payments are disabled");
}
