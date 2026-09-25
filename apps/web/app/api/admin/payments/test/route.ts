export const dynamic = 'force-dynamic';

/**
 * app/api/admin/payments/test/route.ts
 *
 * POST /api/admin/payments/test
 *
 * Lets an admin verify the Paystack provider is wired up correctly (API keys,
 * webhook URL, currency) without needing a real customer transaction.
 * Initiates a small (₦100 equivalent) real payment session using the admin's
 * own email, and returns the checkout URL for them to open and complete
 * manually — whether it uses test or live keys depends entirely on which
 * keys are currently configured (this endpoint doesn't change that).
 *
 * Crypto has no equivalent redirect-checkout to test here — it's a
 * user-initiated on-chain transfer with no server-side session to open.
 * Verify the crypto provider (chain adapters, price feed, receiving
 * addresses) from /gate44/payments instead.
 *
 * Recorded in `payments` with payment_type = 'admin_test' so it never gets
 * confused with a real user purchase, and the webhook handler credits
 * nothing for this type.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { initializePayment } from "@/lib/payments";
import { loadManifest } from "@/lib/manifest";
import { env } from "@/lib/env";

const TestPaymentSchema = z.object({
  provider: z.enum(["paystack"]),
});

/** Nominal test amount — 100 kobo (₦1) / 100 cents ($1) — smallest sensible non-zero charge. */
const TEST_AMOUNT_SMALLEST_UNIT = 100;

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, TestPaymentSchema);
    const manifest = await loadManifest();

    const enabled = manifest.payment.paystackEnabled;
    if (!enabled) {
      throw badRequest(`${body.provider} is not enabled in Payments config. Enable it first at /gate44/config.`);
    }

    const orm = await getDb();

    const [userRow] = await orm
      .select({ email: schema.users.email, username: schema.users.username })
      .from(schema.users)
      .where(eq(schema.users.id, auth.user.sub))
      .limit(1);
    const email = userRow?.email ?? `${userRow?.username ?? "admin"}@zobia.app`;

    const idempotencyKey = `admin_test:${auth.user.sub}:${crypto.randomUUID()}`;
    const returnUrl = `${env.NEXT_PUBLIC_APP_URL}/gate44/config`;
    const metadata = { adminTest: true, initiatedBy: auth.user.sub };

    const [insertRow] = await orm
      .insert(schema.payments)
      .values({
        userId: auth.user.sub,
        paymentType: "admin_test",
        amountKobo: BigInt(TEST_AMOUNT_SMALLEST_UNIT),
        currency: "NGN",
        provider: body.provider,
        status: "pending",
        idempotencyKey,
        metadata,
      })
      .returning({ id: schema.payments.id });
    const paymentDbId = insertRow?.id;

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
      await orm
        .update(schema.payments)
        .set({ providerReference: result.providerReference, updatedAt: new Date() })
        .where(eq(schema.payments.id, paymentDbId))
        .catch(() => {});
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
