/**
 * shared/schemas/api/economy.ts
 *
 * Shared Zod schemas for economy API endpoints (stars, gifts, boosters).
 *
 * ARCH-CONTRACT-01: Single source of truth for economy-related request/response
 * shapes used by web route handlers and Expo API client.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

export const StarGiftRequestSchema = z.object({
  recipientId: z.string().uuid("recipientId must be a valid UUID"),
  amount: z
    .number()
    .int("Amount must be an integer")
    .min(1, "Minimum star gift is 1 star")
    .max(10_000, "Maximum single star gift is 10,000 stars"),
  roomId: z.string().uuid("roomId must be a valid UUID").optional(),
  message: z.string().max(200, "Message must be at most 200 characters").optional(),
});

export type StarGiftRequest = z.infer<typeof StarGiftRequestSchema>;

export const StarBalanceResponseSchema = z.object({
  balance: z.number().int().nonnegative(),
  userId: z.string().uuid(),
});

export type StarBalanceResponse = z.infer<typeof StarBalanceResponseSchema>;

// ---------------------------------------------------------------------------
// Gifts
// ---------------------------------------------------------------------------

export const SendGiftRequestSchema = z.object({
  recipientId: z.string().uuid("recipientId must be a valid UUID"),
  giftId: z.string().uuid("giftId must be a valid UUID"),
  roomId: z.string().uuid("roomId must be a valid UUID").optional(),
  quantity: z
    .number()
    .int("Quantity must be an integer")
    .min(1, "Minimum quantity is 1")
    .max(100, "Maximum quantity per send is 100")
    .default(1),
  message: z.string().max(200).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export type SendGiftRequest = z.infer<typeof SendGiftRequestSchema>;

export const SendGiftResponseSchema = z.object({
  success: z.boolean(),
  giftId: z.string().uuid().optional(),
  coinCost: z.number().int().nonnegative().optional(),
  senderBalance: z.number().int().nonnegative().optional(),
});

export type SendGiftResponse = z.infer<typeof SendGiftResponseSchema>;

// ---------------------------------------------------------------------------
// Booster
// ---------------------------------------------------------------------------

export const BoosterActivateRequestSchema = z.object({
  boosterId: z.string().uuid("boosterId must be a valid UUID"),
  durationHours: z
    .number()
    .int()
    .min(1, "Minimum booster duration is 1 hour")
    .max(72, "Maximum booster duration is 72 hours")
    .optional(),
});

export type BoosterActivateRequest = z.infer<typeof BoosterActivateRequestSchema>;

// ---------------------------------------------------------------------------
// IAP (In-App Purchase)
// ---------------------------------------------------------------------------

export const IAPVerifyRequestSchema = z.object({
  productId: z.string().min(1, "productId is required"),
  purchaseToken: z.string().min(1, "purchaseToken is required"),
  platform: z.enum(["ios", "android"]),
  /** Package name — used for Android receipt verification. */
  packageName: z.string().optional(),
  transactionId: z.string().optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export type IAPVerifyRequest = z.infer<typeof IAPVerifyRequestSchema>;

export const IAPVerifyResponseSchema = z.object({
  success: z.boolean(),
  coinsAdded: z.number().int().nonnegative().optional(),
  newBalance: z.number().int().nonnegative().optional(),
  productId: z.string().optional(),
});

export type IAPVerifyResponse = z.infer<typeof IAPVerifyResponseSchema>;
