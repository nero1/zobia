export const dynamic = 'force-dynamic';

/**
 * POST /api/economy/crypto/confirm
 *
 * Client submits the transaction hash after sending a crypto payment from
 * their wallet. Validates the sender address format server-side, records
 * the hash, then makes one immediate verification attempt so a fast-
 * confirming chain (e.g. Solana) can complete right away without waiting
 * for the client's next status poll.
 *
 * Body: { idempotencyKey: string, txHash: string, senderAddress: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, handleApiError } from "@/lib/api/errors";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { submitTransactionHash, verifyPayment } from "@/lib/payments/crypto";
import { getChainAdapter } from "@/lib/payments/crypto/chains";
import { processChargeSuccess } from "@/lib/payments/paystackWebhookHandler";
import { logger } from "@/lib/logger";

const ConfirmSchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  txHash: z.string().min(10).max(120),
  senderAddress: z.string().min(20).max(64),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const body = await validateBody(req, ConfirmSchema);

    const orm = await getDb();
    const [payment] = await orm
      .select({ chain: schema.payments.chain, amount_kobo: schema.payments.amountKobo, metadata: schema.payments.metadata })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.idempotencyKey, body.idempotencyKey),
          eq(schema.payments.userId, auth.user.sub),
          eq(schema.payments.provider, "crypto")
        )
      )
      .limit(1);
    if (!payment || !payment.chain) {
      throw badRequest("No pending crypto payment found for this reference", "PAYMENT_NOT_FOUND");
    }

    const adapter = getChainAdapter(payment.chain as "bsc" | "solana");
    if (!adapter.isValidAddress(body.senderAddress)) {
      throw badRequest("senderAddress is not a valid address for this chain", "INVALID_ADDRESS");
    }

    await submitTransactionHash({
      userId: auth.user.sub,
      idempotencyKey: body.idempotencyKey,
      txHash: body.txHash,
      senderAddress: body.senderAddress,
    });

    const result = await verifyPayment(body.idempotencyKey);
    if (result.success) {
      await processChargeSuccess({
        reference: body.idempotencyKey,
        status: "success",
        amount: Number(payment.amount_kobo),
        currency: "NGN",
        customer: { email: "" },
        metadata: payment.metadata,
        paid_at: new Date().toISOString(),
      } as Parameters<typeof processChargeSuccess>[0]);
    }

    return NextResponse.json({
      success: true,
      data: { status: result.success ? "completed" : result.pending ? "pending" : "failed", raw: result.raw },
      error: null,
    });
  } catch (err) {
    logger.error({ err }, "[api/economy/crypto/confirm] Failed");
    return handleApiError(err);
  }
});
