/**
 * lib/payments/dodopayments.ts
 *
 * DodoPayments international payment provider integration.
 *
 * All monetary values are in the smallest currency unit
 * (kobo for NGN, cents for USD, etc.).
 *
 * Environment variable required:
 *   DODOPAYMENTS_API_KEY – your DodoPayments API key
 */

import { createHmac } from "crypto";
import Decimal from "decimal.js";
import { env } from "@/lib/env";
import { dodoPaymentsBreaker } from "@/lib/payments/circuit";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DODO_BASE = "https://api.dodopayments.com/v1";

/**
 * Execute an authenticated request to the DodoPayments REST API.
 *
 * @param method - HTTP method
 * @param path   - API path (e.g. "/payment-sessions")
 * @param body   - Optional request body
 */
async function dodoRequest<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const apiKey = env.DODOPAYMENTS_API_KEY;
  if (!apiKey) {
    throw new Error("[dodopayments] DODOPAYMENTS_API_KEY is not configured");
  }

  // Wrap in circuit breaker to prevent cascade failures (S-07)
  return dodoPaymentsBreaker.execute(async () => {
    const res = await fetch(`${DODO_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `[dodopayments] API error ${res.status} on ${method} ${path}: ${text}`
      );
    }

    return res.json() as Promise<T>;
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DodoPaymentSession {
  /** Session identifier to track this payment. */
  id: string;
  /** Redirect URL to send the user to for payment. */
  payment_url: string;
  /** Status of the session at creation ("created"). */
  status: string;
  /** Metadata echoed back from creation. */
  metadata: Record<string, unknown>;
}

export interface DodoPaymentDetail {
  id: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "cancelled";
  amount: number;
  currency: string;
  customer_email?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DodoPayout {
  id: string;
  reference: string;
  status: "pending" | "processing" | "completed" | "failed";
  amount: number;
  currency: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Create a DodoPayments payment session and return the checkout URL.
 *
 * @param amountSmallestUnit - Amount in smallest currency unit (e.g. kobo, cents)
 * @param currency           - ISO 4217 currency code (e.g. "NGN", "USD")
 * @param returnUrl          - URL DodoPayments redirects to after checkout
 * @param metadata           - Arbitrary metadata stored against the session
 * @returns                  Payment session including checkout URL
 */
export async function createPaymentSession(
  amountSmallestUnit: number,
  currency: string,
  returnUrl: string,
  metadata: Record<string, unknown>
): Promise<DodoPaymentSession> {
  const amount = new Decimal(amountSmallestUnit).toDecimalPlaces(0).toNumber();

  return dodoRequest<DodoPaymentSession>("POST", "/payment-sessions", {
    amount,
    currency: currency.toUpperCase(),
    return_url: returnUrl,
    metadata,
  });
}

/**
 * Verify and retrieve the status of a DodoPayments payment.
 *
 * @param paymentId - DodoPayments payment or session ID
 * @returns         Full payment detail including status
 */
export async function verifyPayment(paymentId: string): Promise<DodoPaymentDetail> {
  return dodoRequest<DodoPaymentDetail>("GET", `/payments/${encodeURIComponent(paymentId)}`);
}

/**
 * Validate a DodoPayments webhook HMAC-SHA256 signature.
 *
 * DodoPayments signs the raw request body with your API key using HMAC-SHA256
 * and passes the hex digest in the `x-dodo-signature` header.
 *
 * MUST be called before processing any webhook payload.
 *
 * @param rawBody   - Raw request body bytes or string
 * @param signature - Value of the `x-dodo-signature` header
 * @returns         true if the signature is valid
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signature: string
): boolean {
  const apiKey = env.DODOPAYMENTS_API_KEY;
  if (!apiKey) return false;

  const expected = createHmac("sha256", apiKey)
    .update(rawBody)
    .digest("hex");

  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Initiate an international payout via DodoPayments.
 *
 * @param amountSmallestUnit - Amount in smallest currency unit
 * @param currency           - ISO 4217 currency code
 * @param recipientDetails   - Recipient bank/wallet details
 * @param reference          - Unique idempotency reference for the payout
 * @returns                  Payout record
 */
export async function initiatePayout(
  amountSmallestUnit: number,
  currency: string,
  recipientDetails: Record<string, unknown>,
  reference: string
): Promise<DodoPayout> {
  const amount = new Decimal(amountSmallestUnit).toDecimalPlaces(0).toNumber();

  return dodoRequest<DodoPayout>("POST", "/payouts", {
    amount,
    currency: currency.toUpperCase(),
    recipient: recipientDetails,
    reference,
  });
}
