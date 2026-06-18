/**
 * lib/payments/paystack.ts
 *
 * Paystack payment provider integration.
 *
 * All monetary values are in kobo (smallest NGN unit).
 * Use Decimal.js for any arithmetic before passing values in.
 *
 * Environment variables required:
 *   PAYSTACK_SECRET_KEY  – server-side secret key (sk_live_… or sk_test_…)
 */

import { createHmac } from "crypto";
import Decimal from "decimal.js";
import { env } from "@/lib/env";
import { paystackBreaker } from "@/lib/payments/circuit";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const PAYSTACK_BASE = "https://api.paystack.co";

/**
 * Execute an authenticated request to the Paystack REST API.
 *
 * @param method  - HTTP method
 * @param path    - API path (e.g. "/transaction/initialize")
 * @param body    - Optional request body (will be JSON-encoded)
 */
async function paystackRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const secretKey = env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("[paystack] PAYSTACK_SECRET_KEY is not configured");
  }

  return paystackBreaker.execute(async () => {
    const res = await fetch(`${PAYSTACK_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = (await res.json()) as { status: boolean; message: string; data: T };

    if (!json.status) {
      throw new Error(`[paystack] API error on ${method} ${path}: ${json.message}`);
    }

    return json.data;
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaystackInitializeResponse {
  /** Checkout URL to redirect the user to. */
  authorization_url: string;
  /** Access code for the transaction. */
  access_code: string;
  /** Unique reference for this transaction. */
  reference: string;
}

export interface PaystackVerifyResponse {
  id: number;
  status: "success" | "failed" | "abandoned" | "pending";
  reference: string;
  amount: number; // in kobo
  currency: string;
  customer: { email: string; customer_code: string };
  metadata: Record<string, unknown>;
  paid_at: string | null;
}

export interface PaystackResolveAccountResponse {
  /** Account holder name as returned by the bank. */
  account_name: string;
  /** The account number that was resolved. */
  account_number: string;
  /** Bank ID in Paystack's system. */
  bank_id: number;
}

export interface PaystackTransferRecipientResponse {
  recipient_code: string;
  id: number;
  name: string;
  account_number: string;
  bank_code: string;
}

export interface PaystackTransferResponse {
  transfer_code: string;
  id: number;
  reference: string;
  amount: number;
  status: "pending" | "success" | "failed";
}

export interface PaystackTransferVerifyResponse {
  transfer_code: string;
  id: number;
  reference: string;
  amount: number;
  /** Paystack transfer status values returned by GET /transfer/:code */
  status: "success" | "failed" | "reversed" | "pending" | "otp" | "abandoned";
  reason: string;
  recipient: { recipient_code: string };
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Initialize a Paystack payment session.
 *
 * @param amountKobo  - Amount to charge in kobo (use Decimal.js upstream)
 * @param email       - Customer's email address
 * @param reference   - Unique transaction reference (idempotency key)
 * @param metadata    - Arbitrary key-value pairs stored against the transaction
 * @returns           Checkout URL, access_code, and reference
 */
export async function initializePayment(
  amountKobo: number,
  email: string,
  reference: string,
  metadata: Record<string, unknown>,
  callbackUrl?: string
): Promise<PaystackInitializeResponse> {
  // Paystack expects integer kobo; guard against floats
  const amount = new Decimal(amountKobo).toDecimalPlaces(0).toNumber();

  // Paystack only allows alphanumeric characters and hyphens in transaction references.
  // Replace any other character (e.g. colons, underscores, spaces) with a hyphen.
  const safeReference = reference.replace(/[^a-zA-Z0-9-]/g, '-');

  return paystackRequest<PaystackInitializeResponse>(
    "POST",
    "/transaction/initialize",
    { amount, email, reference: safeReference, metadata, currency: "NGN", ...(callbackUrl ? { callback_url: callbackUrl } : {}) }
  );
}

/**
 * Verify a completed Paystack transaction server-side.
 *
 * @param reference - Transaction reference from Paystack or your system
 * @returns         Full transaction detail including status and amount
 */
export async function verifyPayment(
  reference: string
): Promise<PaystackVerifyResponse> {
  return paystackRequest<PaystackVerifyResponse>(
    "GET",
    `/transaction/verify/${encodeURIComponent(reference)}`
  );
}

/**
 * Validate a Paystack webhook HMAC-SHA512 signature.
 *
 * Paystack signs the raw request body with your secret key using HMAC-SHA512
 * and passes the hex digest in the `x-paystack-signature` header.
 *
 * MUST be called before processing any webhook payload.
 *
 * @param rawBody   - Raw request body bytes (Buffer or string)
 * @param signature - Value of the `x-paystack-signature` header
 * @returns         true if signature is valid, false otherwise
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signature: string
): boolean {
  const secretKey = env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return false;

  const expected = createHmac("sha512", secretKey)
    .update(rawBody)
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Resolve (verify) a Nigerian bank account number via Paystack.
 *
 * Must be called before creating a transfer recipient to confirm the account
 * exists and obtain the account holder's name for user confirmation.
 *
 * @param accountNumber - 10-digit Nigerian bank account number
 * @param bankCode      - CBN bank code (e.g. "057" for Zenith Bank)
 * @returns Account name and number as confirmed by the bank
 */
export async function resolveAccount(
  accountNumber: string,
  bankCode: string
): Promise<PaystackResolveAccountResponse> {
  const params = new URLSearchParams({ account_number: accountNumber, bank_code: bankCode });
  return paystackRequest<PaystackResolveAccountResponse>(
    "GET",
    `/bank/resolve?${params.toString()}`
  );
}

/**
 * Create a Paystack transfer recipient (bank account) for payouts.
 *
 * @param accountNumber - Nigerian bank account number (10 digits)
 * @param bankCode      - CBN bank code (e.g. "057" for Zenith Bank)
 * @param name          - Account holder's full name
 * @returns             Recipient object including recipient_code
 */
export async function createTransferRecipient(
  accountNumber: string,
  bankCode: string,
  name: string
): Promise<PaystackTransferRecipientResponse> {
  return paystackRequest<PaystackTransferRecipientResponse>(
    "POST",
    "/transferrecipient",
    { type: "nuban", name, account_number: accountNumber, bank_code: bankCode, currency: "NGN" }
  );
}

/**
 * Verify the current status of a Paystack transfer by its transfer_code.
 *
 * Used during payout reconciliation to re-query the provider for transfers
 * whose webhooks were lost or never received.
 *
 * @param transferCode - The transfer_code returned by initiateTransfer
 * @returns Transfer detail including current status
 */
export async function verifyTransfer(
  transferCode: string
): Promise<PaystackTransferVerifyResponse> {
  return paystackRequest<PaystackTransferVerifyResponse>(
    "GET",
    `/transfer/${encodeURIComponent(transferCode)}`
  );
}

/**
 * Initiate a Paystack bank transfer (payout).
 *
 * @param amountKobo    - Amount to transfer in kobo
 * @param recipientCode - Paystack recipient_code from createTransferRecipient
 * @param reference     - Unique reference for this transfer (idempotency key)
 * @param reason        - Human-readable transfer reason
 * @returns             Transfer record including transfer_code
 */
export async function initiateTransfer(
  amountKobo: number,
  recipientCode: string,
  reference: string,
  reason: string
): Promise<PaystackTransferResponse> {
  const amount = new Decimal(amountKobo).toDecimalPlaces(0).toNumber();

  return paystackRequest<PaystackTransferResponse>(
    "POST",
    "/transfer",
    {
      source: "balance",
      amount,
      recipient: recipientCode,
      reference,
      reason,
      currency: "NGN",
    }
  );
}
