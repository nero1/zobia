export const dynamic = 'force-dynamic';

/**
 * app/api/business/pending/route.ts
 *
 * GET    /api/business/pending — is there a pending business signup/upgrade
 *        payment in progress, and when does it expire?
 * DELETE /api/business/pending — cancel it, so the user can immediately
 *        retry instead of waiting out the 30-minute TTL. Handles the case
 *        where a Paystack checkout was abandoned (PRD payment edge case):
 *        the user comes back to Zobia and either wants to try again with a
 *        different tier/provider, or their first attempt never completed.
 *
 * Cancelling a signup payment just marks the `payments` row cancelled — no
 * business_accounts row exists yet (it's only created by the webhook on
 * success). Cancelling an upgrade payment also clears the pending_tier /
 * pending_payment_ref fields on business_accounts so a fresh upgrade attempt
 * isn't blocked by BIZ-TIER-RACE.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

/** Mirrors PENDING_PAYMENT_TTL_MINUTES in app/api/business/route.ts and tier/route.ts. */
const PENDING_PAYMENT_TTL_MINUTES = 30;

interface PendingPaymentRow {
  id: string;
  created_at: string;
  metadata: { itemType?: string; businessAccountId?: string } | null;
}

async function findPendingBusinessPayment(userId: string): Promise<PendingPaymentRow | null> {
  const orm = await getDb();
  const rows = await orm
    .select({
      id: schema.payments.id,
      createdAt: schema.payments.createdAt,
      metadata: schema.payments.metadata,
    })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.userId, userId),
        eq(schema.payments.paymentType, "business_upgrade"),
        eq(schema.payments.status, "pending"),
        inArray(sql<string>`${schema.payments.metadata}->>'itemType'`, [
          "business_signup",
          "business_upgrade",
          "business_renewal",
        ])
      )
    )
    .orderBy(desc(schema.payments.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    created_at: row.createdAt ? row.createdAt.toISOString() : "",
    metadata: row.metadata as PendingPaymentRow["metadata"],
  };
}

// ---------------------------------------------------------------------------
// GET /api/business/pending
// ---------------------------------------------------------------------------

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const pending = await findPendingBusinessPayment(auth.user.sub);
    if (!pending) {
      return NextResponse.json({ success: true, data: { pending: null }, error: null });
    }
    const expiresAt = new Date(
      new Date(pending.created_at).getTime() + PENDING_PAYMENT_TTL_MINUTES * 60_000
    ).toISOString();
    const expired = Date.parse(expiresAt) <= Date.now();
    return NextResponse.json({
      success: true,
      data: {
        pending: expired ? null : { itemType: pending.metadata?.itemType ?? null, expiresAt },
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/business/pending — cancel the in-progress signup/upgrade payment
// ---------------------------------------------------------------------------

export const DELETE = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    const pending = await findPendingBusinessPayment(userId);
    if (!pending) throw notFound("No pending business payment to cancel");

    const orm = await getDb();
    await orm
      .update(schema.payments)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(schema.payments.id, pending.id));

    const businessAccountId = pending.metadata?.businessAccountId;
    if (pending.metadata?.itemType === "business_upgrade" && businessAccountId) {
      await orm
        .update(schema.businessAccounts)
        .set({ pendingTier: null, pendingPaymentRef: null, updatedAt: new Date() })
        .where(eq(schema.businessAccounts.id, businessAccountId));
    }

    return NextResponse.json({ success: true, data: { cancelled: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
