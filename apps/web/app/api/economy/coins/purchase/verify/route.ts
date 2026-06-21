export const dynamic = "force-dynamic";

/**
 * app/api/economy/coins/purchase/verify/route.ts
 *
 * POST /api/economy/coins/purchase/verify
 *
 * Called by the purchase callback page after Paystack redirects the user back.
 * Checks our local payments table for the transaction status.
 * The actual coin credit is handled by the Paystack webhook — this endpoint
 * only checks whether the webhook has already processed the payment.
 *
 * Returns:
 *   { success: true, data: { status, coinsGranted } }  — payment processed
 *   { success: false, pending: true }                  — webhook not yet received
 *   { success: false, error: { message } }             — error / not found
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

const bodySchema = z.object({
  reference: z.string().min(1).max(200),
});

interface PaymentRow {
  status: string;
  metadata: Record<string, unknown> | null;
  coins_granted: number | null;
}

export const POST = withAuth(async (req: NextRequest, { auth }): Promise<NextResponse> => {
  try {
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: { message: "Invalid reference" } }, { status: 400 });
    }

    const { reference } = parsed.data;

    const { rows } = await db.query<PaymentRow>(
      `SELECT p.status,
              p.metadata,
              cl.amount AS coins_granted
       FROM payments p
       LEFT JOIN coin_ledger cl ON cl.reference_id = p.id::text AND cl.transaction_type = 'iap_purchase'
       WHERE p.provider_reference = $1
         AND p.user_id = $2
       LIMIT 1`,
      [reference, auth.user.sub]
    );

    if (!rows[0]) {
      return NextResponse.json(
        { success: false, error: { message: "Payment record not found." } },
        { status: 404 }
      );
    }

    const payment = rows[0];

    if (payment.status === "completed" || payment.status === "success") {
      const coinsGranted =
        payment.coins_granted ??
        (payment.metadata as Record<string, number> | null)?.coinsGranted ??
        null;
      return NextResponse.json({
        success: true,
        data: { status: "completed", coinsGranted },
        message: coinsGranted
          ? `Payment confirmed! ${coinsGranted.toLocaleString()} coins have been credited to your wallet.`
          : "Payment confirmed! Your coins have been credited.",
      });
    }

    if (payment.status === "failed" || payment.status === "cancelled") {
      return NextResponse.json({
        success: false,
        error: { message: "Payment was not completed. Please try again." },
      });
    }

    // Still pending — webhook hasn't fired yet
    return NextResponse.json({
      success: false,
      pending: true,
      error: { message: "Your payment is being processed. Your coins will appear in your wallet shortly." },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
