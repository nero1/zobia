/**
 * lib/payments/freeGrant.ts
 *
 * Grants a purchase immediately, bypassing every payment provider, when the
 * admin has flipped a `payment_context_settings` row's `is_free` toggle
 * (gate44/payments danger zone, or the "make all payments free" button).
 *
 * Records a real `payments` row (provider = 'free', amount_received_kobo =
 * 0) for auditability, then reuses the exact same `processChargeSuccess`
 * fulfilment logic a real Paystack/crypto charge would trigger — so every
 * itemType branch (coins, stars, subscription, business tier/renewal) stays
 * in one place instead of being re-implemented per free-grant call site.
 *
 * @module lib/payments/freeGrant
 */

import { getDb, schema } from "@/lib/db/drizzle";
import { logger } from "@/lib/logger";
import { processChargeSuccess, type PaystackChargeEvent } from "@/lib/payments/paystackWebhookHandler";

export async function grantFreePayment(params: {
  userId: string;
  paymentType: string;
  amountKobo: number;
  currency: string;
  idempotencyKey: string;
  metadata: PaystackChargeEvent["data"]["metadata"];
}): Promise<void> {
  const orm = await getDb();
  await orm
    .insert(schema.payments)
    .values({
      userId: params.userId,
      paymentType: params.paymentType,
      amountKobo: BigInt(params.amountKobo),
      currency: params.currency,
      provider: "free",
      status: "pending",
      idempotencyKey: params.idempotencyKey,
      providerReference: params.idempotencyKey,
      metadata: params.metadata,
    })
    .onConflictDoNothing({ target: schema.payments.idempotencyKey });

  logger.info({ userId: params.userId, paymentType: params.paymentType, idempotencyKey: params.idempotencyKey }, "[payments/freeGrant] Granting purchase for free (admin is_free toggle)");

  await processChargeSuccess({
    reference: params.idempotencyKey,
    status: "success",
    amount: 0,
    currency: params.currency,
    customer: { email: "" },
    metadata: params.metadata,
    paid_at: new Date().toISOString(),
  } as PaystackChargeEvent["data"]);
}
