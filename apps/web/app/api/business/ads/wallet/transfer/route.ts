export const dynamic = 'force-dynamic';

/**
 * app/api/business/ads/wallet/transfer/route.ts
 *
 * POST /api/business/ads/wallet/transfer — move Credits from the caller's
 * main wallet (coin_balance) into their Ad Wallet (ad_wallet_balance).
 * No fee, 1:1 — this is an internal reallocation, not a purchase or a
 * transfer to another user. Both legs write to their respective ledgers in
 * one DB transaction so a failure never leaves Credits "lost" in between.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { withAuth, validateBody, type AuthContext } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
import { debitCoins } from "@/lib/economy/coins";
import { creditAdWallet } from "@/lib/economy/adWallet";

const bodySchema = z.object({
  amountCredits: z.number().int().positive().max(10_000_000),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export const POST = withAuth(async (req: NextRequest, { auth }: { auth: AuthContext }) => {
  try {
    await requireFeatureEnabled("adsSystem");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.coinPurchase);
    const body = await validateBody(req, bodySchema);
    const userId = auth.user.sub;
    const ref = body.idempotencyKey ?? `${userId}:adwallet-transfer:${randomUUID()}`;

    try {
      const result = await db.transaction(async (tx: TransactionClient) => {
        await debitCoins(userId, body.amountCredits, "ad_wallet_transfer", `${ref}:debit`, "Transfer to Ad Wallet", null, tx);
        const credit = await creditAdWallet(userId, body.amountCredits, "transfer_in", `${ref}:credit`, "Transfer from main wallet", null, tx);
        return credit;
      });
      return NextResponse.json({ success: true, data: { adWalletBalance: Number(result.balance_after) }, error: null });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "INSUFFICIENT_BALANCE") {
        throw badRequest("Insufficient Credit balance.", "INSUFFICIENT_BALANCE");
      }
      throw err;
    }
  } catch (err) {
    return handleApiError(err);
  }
});
