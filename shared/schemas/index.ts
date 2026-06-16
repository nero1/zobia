/**
 * shared/schemas/index.ts
 *
 * Barrel re-export of all shared Zod API schemas.
 *
 * Import via:
 *   import { CoinTransferRequestSchema } from '@zobia/shared/schemas';
 * or from specific domain:
 *   import { CoinTransferRequestSchema } from '@zobia/shared/schemas/coins';
 *
 * ARCH-CONTRACT-01: Single source of truth for API contracts shared between
 * the Next.js web app and Expo mobile app.
 */

export * from "./api/auth";
export * from "./api/coins";
export * from "./api/user";
export * from "./api/notifications";
export * from "./api/economy";
