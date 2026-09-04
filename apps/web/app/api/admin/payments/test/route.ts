export const dynamic = 'force-dynamic';

/**
 * app/api/admin/payments/test/route.ts
 *
 * POST /api/admin/payments/test
 *
 * Lets an admin verify a payment provider is wired up correctly (API keys,
 * webhook URL, currency) without needing a real customer transaction.
 * Initiates a small (₦100 / $1 equivalent) real payment session through the
 * requested provider using the admin's own email, and returns the checkout
 * URL for them to open and complete manually — whether it uses the
 * provider's test or live keys depends entirely on which keys are currently
 * configured for that provider (this endpoint doesn't change that).
 *
 * Recorded in `payments` with payment_type = 'admin_test' so it never gets
 * confused with a real user purchase, and the webhook handler credits
 * nothing for this type.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { initializePayment } from "@/lib/payments";
import { loadManifest } from "@/lib/manifest";
import { env } from "@/lib/env";

const TestPaymentSchema = z.object({
  provider: z.enum(["paystack", "dodopayments"]),
});

/** Nominal test amount — 100 kobo (₦1) / 100 cents ($1) — smallest sensible non-zero charge. */
const TEST_AMOUNT_SMALLEST_UNIT = 100;

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, TestPaymentSchema);
    const manifest = await loadManifest();

    const enabled =
      body.provider === "paystack" ? manifest.payment.paystackEnabled : manifest.payment.dodopaymentsEnabled;
    if (!enabled) {
      throw badRequest(`${body.provider} is not enabled in Payments config. Enable it first at /gate44/config.`);
    }

    const { rows: userRows } = await db.query<{ email: string | null; username: string }>(
      `SELECT email, username FROM users WHERE id = $1 LIMIT 1`,
      [auth.user.sub]
    );
    const email = userRows[0]?.email ?? `${userRows[0]?.username ?? "admin"}@zobia.app`;

    const idempotencyKey = `admin_test:${auth.user.sub}:${crypto.randomUUID()}`;
    const returnUrl = `${env.NEXT_PUBLIC_APP_URL}/gate44/config`;
    const metadata = { adminTest: true, initiatedBy: auth.user.sub };

    const { rows: insertRows } = await db.query<{ id: string }>(
      `INSERT INTO payments (user_id, payment_type, amount_kobo, currency, provider, status, idempotency_key, metadata)
       VALUES ($1, 'admin_test', $2, 'NGN', $3, 'pending', $4, $5)
       RETURNING id`,
      [auth.user.sub, TEST_AMOUNT_SMALLEST_UNIT, body.provider, idempotencyKey, JSON.stringify(metadata)]
    );
    const paymentDbId = insertRows[0]?.id;

    const result = await initializePayment(
      TEST_AMOUNT_SMALLEST_UNIT,
      "NGN",
      email,
      idempotencyKey,
      metadata,
      returnUrl,
      body.provider
    );

    if (paymentDbId) {
      await db.query(
        `UPDATE payments SET provider_reference = $1, updated_at = NOW() WHERE id = $2`,
        [result.providerReference, paymentDbId]
      ).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      data: { paymentUrl: result.paymentUrl, provider: body.provider, amountSmallestUnit: TEST_AMOUNT_SMALLEST_UNIT },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
