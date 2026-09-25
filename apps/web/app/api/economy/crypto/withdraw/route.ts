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
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

    const orm = await getDb();
    const [walletRow] = await orm
      .select({ address: schema.userCryptoWallets.address })
      .from(schema.userCryptoWallets)
      .where(and(eq(schema.userCryptoWallets.userId, userId), eq(schema.userCryptoWallets.chain, token.chain)))
      .limit(1);
    if (!walletRow) {
      throw badRequest(
        `Add a ${token.chain === "bsc" ? "BNB Smart Chain" : "Solana"} wallet address before withdrawing ${currency}.`,
        "NO_WALLET_ADDRESS"
      );
    }

    const threshold = await getCryptoPayoutThreshold(currency);

    const payoutId = await orm.transaction(async (tx) => {
      const [balRow] = await tx
        .select({ balance_base_units: schema.creatorCryptoBalances.balanceBaseUnits })
        .from(schema.creatorCryptoBalances)
        .where(and(eq(schema.creatorCryptoBalances.userId, userId), eq(schema.creatorCryptoBalances.currency, currency)))
        .for("update");
      const balance = BigInt(balRow?.balance_base_units ?? "0");
      if (balance < threshold) {
        throw badRequest(
          `Your ${currency} balance is below the minimum withdrawal threshold.`,
          "BELOW_PAYOUT_THRESHOLD"
        );
      }

      await tx
        .update(schema.creatorCryptoBalances)
        .set({
          balanceBaseUnits: sql`${schema.creatorCryptoBalances.balanceBaseUnits} - ${balance.toString()}`,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.creatorCryptoBalances.userId, userId), eq(schema.creatorCryptoBalances.currency, currency)));

      const idempotencyKey = `crypto_payout:${userId}:${currency}:${randomUUID()}`;
      const [payoutRow] = await tx
        .insert(schema.creatorPayouts)
        .values({
          creatorId: userId,
          amountKobo: BigInt(0),
          provider: "crypto",
          payoutMethod: "crypto",
          walletAddressSnapshot: walletRow.address,
          cryptoCurrency: currency,
          cryptoChain: token.chain,
          cryptoAmountBaseUnits: balance.toString(),
          status: "pending",
          requiresManualApproval: true,
          idempotencyKey,
        })
        .returning({ id: schema.creatorPayouts.id });
      return payoutRow?.id;
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
