/**
 * shared/schemas/api/coins.ts
 *
 * Shared Zod schemas for coin economy API endpoints.
 *
 * ARCH-CONTRACT-01: Single source of truth for coin transfer, balance,
 * and purchase schemas between web route handlers and Expo API client.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------

export const CoinTransferRequestSchema = z.object({
  recipientId: z.string().uuid("recipientId must be a valid UUID"),
  /**
   * Gross coin amount. Sender pays this full amount; recipient receives
   * 95% after the 5% platform fee.
   */
  amount: z
    .number()
    .int("Amount must be an integer")
    .min(10, "Minimum transfer amount is 10 coins")
    .max(100_000, "Maximum single transfer is 100,000 coins"),
  idempotencyKey: z
    .string()
    .uuid("idempotencyKey must be a valid UUID")
    .optional(),
});

export type CoinTransferRequest = z.infer<typeof CoinTransferRequestSchema>;

export const CoinTransferResponseSchema = z.object({
  success: z.boolean(),
  duplicate: z.boolean().optional(),
  transfer: z
    .object({
      grossAmount: z.number().int(),
      feeCoins: z.number().int(),
      netAmount: z.number().int(),
      recipient: z.object({
        id: z.string().uuid(),
        username: z.string(),
      }),
    })
    .optional(),
  senderBalance: z.number().optional(),
  recipientBalance: z.number().optional(),
  message: z.string().optional(),
});

export type CoinTransferResponse = z.infer<typeof CoinTransferResponseSchema>;

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

export const CoinBalanceResponseSchema = z.object({
  balance: z.number().int().nonnegative(),
  userId: z.string().uuid(),
});

export type CoinBalanceResponse = z.infer<typeof CoinBalanceResponseSchema>;

// ---------------------------------------------------------------------------
// Purchase
// ---------------------------------------------------------------------------

export const CoinPurchaseRequestSchema = z.object({
  packageId: z.string().min(1, "packageId is required"),
  paymentReference: z.string().min(1, "paymentReference is required"),
  idempotencyKey: z.string().uuid("idempotencyKey must be a valid UUID").optional(),
});

export type CoinPurchaseRequest = z.infer<typeof CoinPurchaseRequestSchema>;

export const CoinPurchaseResponseSchema = z.object({
  success: z.boolean(),
  coinsAdded: z.number().int().nonnegative().optional(),
  newBalance: z.number().int().nonnegative().optional(),
  transactionId: z.string().optional(),
});

export type CoinPurchaseResponse = z.infer<typeof CoinPurchaseResponseSchema>;

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export const CoinLedgerEntrySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  amount: z.number().int(),
  balance_before: z.number().int(),
  balance_after: z.number().int(),
  transaction_type: z.string(),
  reference_id: z.string().nullable(),
  description: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  created_at: z.string(),
});

export type CoinLedgerEntry = z.infer<typeof CoinLedgerEntrySchema>;
