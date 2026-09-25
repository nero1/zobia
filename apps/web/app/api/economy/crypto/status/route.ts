export const dynamic = 'force-dynamic';

/**
 * GET /api/economy/crypto/status?ref=<idempotencyKey>
 *
 * Poll the status of a crypto payment. This is the PRIMARY confirmation
 * path — the client polls this every few seconds while the user waits on
 * the confirmation screen (the daily CRON reconciliation pass is only a
 * safety net for tabs closed mid-flow, see app/api/cron/daily-platform).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { badRequest, handleApiError, notFound } from "@/lib/api/errors";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { verifyPayment } from "@/lib/payments/crypto";
import { processChargeSuccess } from "@/lib/payments/paystackWebhookHandler";

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.cryptoStatusPoll);

    const ref = new URL(req.url).searchParams.get("ref");
    if (!ref) throw badRequest("Query param 'ref' is required");

    const orm = await getDb();
    const [payment] = await orm
      .select({
        status: schema.payments.status,
        amount_kobo: schema.payments.amountKobo,
        metadata: schema.payments.metadata,
        tx_hash: schema.payments.txHash,
      })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.idempotencyKey, ref),
          eq(schema.payments.userId, auth.user.sub),
          eq(schema.payments.provider, "crypto")
        )
      )
      .limit(1);
    if (!payment) throw notFound("Payment not found");

    if (payment.status === "completed" || payment.status === "failed") {
      return NextResponse.json({ success: true, data: { status: payment.status }, error: null });
    }
    if (!payment.tx_hash) {
      return NextResponse.json({ success: true, data: { status: "awaiting_tx_hash" }, error: null });
    }

    const result = await verifyPayment(ref);
    if (result.success) {
      await processChargeSuccess({
        reference: ref,
        status: "success",
        amount: Number(payment.amount_kobo),
        currency: "NGN",
        customer: { email: "" },
        metadata: payment.metadata,
        paid_at: new Date().toISOString(),
      } as Parameters<typeof processChargeSuccess>[0]);
      return NextResponse.json({ success: true, data: { status: "completed" }, error: null });
    }

    return NextResponse.json({
      success: true,
      data: { status: result.pending ? "pending" : "failed", raw: result.raw },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
