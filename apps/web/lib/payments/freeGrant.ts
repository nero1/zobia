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

import { db } from "@/lib/db";
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
  await db.query(
    `INSERT INTO payments
       (user_id, payment_type, amount_kobo, currency, provider, status,
        idempotency_key, provider_reference, metadata)
     VALUES ($1, $2, $3, $4, 'free', 'pending', $5, $5, $6)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [params.userId, params.paymentType, params.amountKobo, params.currency, params.idempotencyKey, JSON.stringify(params.metadata)]
  );

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
