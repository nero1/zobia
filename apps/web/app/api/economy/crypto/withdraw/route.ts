export const dynamic = "force-dynamic";

/**
 * POST /api/economy/crypto/withdraw
 *
 * Request a withdrawal of the signed-in user's crypto-native balance
 * (creator_crypto_balances) to their saved wallet for that chain
 * (user_crypto_wallets). Debits the balance immediately (atomically, inside
 * the same transaction as the payout row) so the same funds can never be
 * withdrawn twice; the actual on-chain send is processed manually by an
 * admin — mirrors the existing creator_payouts 'crypto' method, which
 * lib/payments/crypto/index.ts's createPayout() already documents as
 * always-manual (no automated crypto payouts).
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getCryptoPayoutsEnabled, getCryptoPayoutMode, getCryptoPayoutThreshold } from "@/lib/payments/crypto/payouts";
import { getToken } from "@/lib/payments/crypto/tokens";
import { writeAuditLog } from "@/lib/audit/auditLog";
import { logger } from "@/lib/logger";
import type { CryptoCurrency } from "@zobia/types";

const WithdrawSchema = z.object({
  currency: z.enum(["JAGA", "BNB", "SOL"]),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const userId = auth.user.sub;

    const [enabled, mode] = await Promise.all([getCryptoPayoutsEnabled(), getCryptoPayoutMode()]);
    if (!enabled || mode !== "crypto") {
      throw badRequest("Crypto withdrawals are not currently available.", "CRYPTO_PAYOUTS_DISABLED");
    }

    const body = await validateBody(req, WithdrawSchema);
    const currency = body.currency as CryptoCurrency;
    const token = getToken(currency);

    const { rows: walletRows } = await db.query<{ address: string }>(
      `SELECT address FROM user_crypto_wallets WHERE user_id = $1 AND chain = $2 LIMIT 1`,
      [userId, token.chain]
    );
    if (!walletRows[0]) {
      throw badRequest(
        `Add a ${token.chain === "bsc" ? "BNB Smart Chain" : "Solana"} wallet address before withdrawing ${currency}.`,
        "NO_WALLET_ADDRESS"
      );
    }

    const threshold = await getCryptoPayoutThreshold(currency);

    const payoutId = await db.transaction(async (tx) => {
      const { rows: balRows } = await tx.query<{ balance_base_units: string }>(
        `SELECT balance_base_units FROM creator_crypto_balances WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
        [userId, currency]
      );
      const balance = BigInt(balRows[0]?.balance_base_units ?? "0");
      if (balance < threshold) {
        throw badRequest(
          `Your ${currency} balance is below the minimum withdrawal threshold.`,
          "BELOW_PAYOUT_THRESHOLD"
        );
      }

      await tx.query(
        `UPDATE creator_crypto_balances SET balance_base_units = balance_base_units - $1, updated_at = NOW()
         WHERE user_id = $2 AND currency = $3`,
        [balance.toString(), userId, currency]
      );

      const idempotencyKey = `crypto_payout:${userId}:${currency}:${randomUUID()}`;
      const { rows: payoutRows } = await tx.query<{ id: string }>(
        `INSERT INTO creator_payouts
           (creator_id, amount_kobo, provider, payout_method, wallet_address_snapshot,
            crypto_currency, crypto_chain, crypto_amount_base_units, status,
            requires_manual_approval, idempotency_key, created_at)
         VALUES ($1, 0, 'crypto', 'crypto', $2, $3, $4, $5, 'pending', TRUE, $6, NOW())
         RETURNING id`,
        [userId, walletRows[0].address, currency, token.chain, balance.toString(), idempotencyKey]
      );
      return payoutRows[0]?.id;
    });

    writeAuditLog({
      actorId: userId,
      action: "crypto_withdrawal_requested",
      targetType: "creator_payout",
      targetId: payoutId,
      metadata: { currency },
    });
    logger.info({ userId, currency, payoutId }, "[crypto:withdraw] withdrawal requested");

    return NextResponse.json({ success: true, data: { payoutId, status: "pending" }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
