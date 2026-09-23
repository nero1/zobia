export const dynamic = "force-dynamic";

/**
 * POST /api/classroom/:roomId/enroll/verify
 *
 * Fixes the classroom enrollment flow getting stuck on "Payment received —
 * finishing your enrolment…" forever: enrolment for a card payment was only
 * ever written by the Paystack webhook, with no fallback if that webhook was
 * delayed, misconfigured, or failed. When the user is bounced back from
 * Paystack checkout (?payment=complete), the client now calls this endpoint,
 * which independently re-verifies the charge with Paystack and finalizes the
 * enrolment itself if the webhook hasn't landed yet — never trusting the
 * client, only Paystack's own verify response.
 *
 * `processChargeSuccess` is idempotent (keyed on `payments.provider_reference`
 * / status), so calling it here and again from the webhook (if it later
 * arrives) is safe — the second call is a no-op.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { verifyPayment } from "@/lib/payments/paystack";
import { processChargeSuccess } from "@/lib/payments/paystackWebhookHandler";
import { classroomPaymentReference } from "@/lib/classroom/enrolment";
import { assertUuid } from "@/lib/classroom/http";
import { logger } from "@/lib/logger";

export const POST = withAuth<{ roomId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const roomId = assertUuid(params.roomId);
    const userId = auth.user.sub;

    const reference = classroomPaymentReference(roomId, userId);
    const { rows } = await db.query<{ status: string; metadata: Record<string, unknown> }>(
      `SELECT status, metadata FROM payments WHERE provider_reference = $1 AND provider = 'paystack' LIMIT 1`,
      [reference]
    );
    const payment = rows[0];
    if (!payment) throw notFound("No pending payment found for this classroom");

    if (payment.status === "completed") {
      return NextResponse.json({ success: true, data: { status: "completed" }, error: null });
    }

    const result = await verifyPayment(reference);
    if (result.status === "success") {
      await processChargeSuccess({
        reference,
        status: "success",
        amount: result.amount,
        currency: result.currency,
        customer: { email: "" },
        metadata: payment.metadata,
        paid_at: new Date().toISOString(),
      } as Parameters<typeof processChargeSuccess>[0]);
      return NextResponse.json({ success: true, data: { status: "completed" }, error: null });
    }

    if (result.status === "failed" || result.status === "abandoned") {
      return NextResponse.json({ success: true, data: { status: "failed" }, error: null });
    }

    return NextResponse.json({ success: true, data: { status: "pending" }, error: null });
  } catch (err) {
    logger.error({ err }, "[classroom:enroll:verify] Failed");
    return handleApiError(err);
  }
});
