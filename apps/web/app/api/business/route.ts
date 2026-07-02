export const dynamic = 'force-dynamic';

/**
 * app/api/business/route.ts
 *
 * Business account management.
 *
 * GET /api/business
 *   Get the caller's business account.
 *
 * POST /api/business
 *   Initiate a Business Starter account purchase (PRD §17 — Business Starter
 *   is a paid tier, admin-configurable price, default ₦5,000/month). Returns
 *   { paymentUrl } — the client redirects to checkout. The business_accounts
 *   row is only created once the payment webhook fires (see
 *   lib/payments/paystackWebhookHandler.ts / dodoWebhookHandler.ts,
 *   itemType "business_signup"), mirroring the subscription purchase flow.
 *
 * PATCH /api/business
 *   Update business account details.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled, loadManifest } from "@/lib/manifest";
import { handleApiError, notFound, conflict, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { initializePayment as paystackInit } from "@/lib/payments/paystack";
import { createPaymentSession as dodoCreateSession } from "@/lib/payments/dodopayments";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default Business Starter price in kobo (admin can override via x_manifest). PRD §17. */
const DEFAULT_STARTER_PRICE_KOBO = 500_000; // ₦5,000

/**
 * How long a pending business-signup payment session is considered "still in
 * progress" before a new one is allowed — mirrors BIZ-TIER-RACE in
 * app/api/business/tier/route.ts. Prevents a user double-clicking "Continue
 * to Payment" from opening two checkout sessions and potentially paying twice
 * before the first webhook creates the account.
 */
const PENDING_PAYMENT_TTL_MINUTES = 30;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createBusinessSchema = z.object({
  business_name: z.string().min(2).max(120),
  business_type: z.string().max(80).optional(),
  paymentProvider: z.enum(["paystack", "dodopayments"]).optional(),
});

const updateBusinessSchema = z.object({
  business_name: z.string().min(2).max(120).optional(),
  business_type: z.string().max(80).optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BusinessAccountRow {
  id: string;
  user_id: string;
  business_name: string;
  business_type: string | null;
  tier: string;
  verified: boolean;
  status: string;
  verification_status: string;
  verification_requested_at: string | null;
  verification_reviewed_at: string | null;
  verification_reject_reason: string | null;
  subscription_id: string | null;
  downgrade_to_tier: string | null;
  downgrade_effective_at: string | null;
  created_at: string;
  updated_at: string;
}

const BUSINESS_SELECT_COLUMNS = `id, user_id, business_name, business_type, tier, verified, status,
              verification_status, verification_requested_at, verification_reviewed_at,
              verification_reject_reason, subscription_id, downgrade_to_tier, downgrade_effective_at,
              created_at, updated_at`;

// ---------------------------------------------------------------------------
// GET /api/business
// ---------------------------------------------------------------------------

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const { rows } = await db.query<BusinessAccountRow>(
      `SELECT ${BUSINESS_SELECT_COLUMNS}
       FROM business_accounts
       WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    if (!rows[0]) throw notFound("Business account not found");

    return NextResponse.json({
      success: true,
      data: { business: rows[0] },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/business — initiate Business Starter purchase
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("businessAccounts");
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, createBusinessSchema);

    // Check for existing business account
    const { rows: existing } = await db.query<{ id: string }>(
      `SELECT id FROM business_accounts WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (existing.length > 0) {
      throw conflict("You already have a business account");
    }

    // Load user record for the payment provider's email requirement
    const { rows: userRows } = await db.query<{ email: string | null; username: string }>(
      `SELECT email, username FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    if (!userRows[0]) throw notFound("User not found");
    const userEmail = userRows[0].email ?? `${userRows[0].username}@zobia.placeholder`;

    // Resolve Business Starter price from x_manifest (admin-configurable)
    let priceKobo = DEFAULT_STARTER_PRICE_KOBO;
    try {
      const manifest = await loadManifest();
      const manifestPrice = (manifest as unknown as Record<string, unknown>)["business_starter_price_kobo"];
      if (typeof manifestPrice === "number" && manifestPrice > 0) {
        priceKobo = manifestPrice;
      }
    } catch {
      // Fall back to default
    }

    if (priceKobo <= 0) {
      throw badRequest("Invalid tier price configuration");
    }

    const provider = body.paymentProvider ?? "paystack";
    const reference = `biz-signup-${userId}-${randomUUID().slice(0, 8)}`;

    const metadata = {
      userId,
      businessName: body.business_name,
      businessType: body.business_type ?? null,
      type: "business_signup",
      itemType: "business_signup",
    };

    // BIZ-SIGNUP-RACE: reserve the pending-payment slot atomically *before*
    // calling out to the payment provider (a slow network round-trip). A
    // plain "SELECT for an existing pending payment, then INSERT one" check
    // leaves a window — during the provider HTTP call — where a second
    // concurrent POST would also pass the SELECT and open a second checkout
    // session, letting the user pay twice for one account. Reserving first
    // (single atomic INSERT ... WHERE NOT EXISTS) closes that window: only
    // one concurrent request can win the reservation, so only one payment
    // provider session is ever created per pending-payment window.
    const { rows: reservedRows } = await db.query<{ id: string }>(
      `INSERT INTO payments
         (user_id, payment_type, amount_kobo, currency, provider,
          status, idempotency_key, provider_reference, metadata)
       SELECT $1, 'business_upgrade', $2, 'NGN', $3, 'pending', $4, $4, $5::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM payments
         WHERE user_id = $1
           AND payment_type = 'business_upgrade'
           AND status = 'pending'
           AND metadata->>'itemType' = 'business_signup'
           AND created_at > NOW() - INTERVAL '${PENDING_PAYMENT_TTL_MINUTES} minutes'
       )
       RETURNING id`,
      [userId, priceKobo, provider, reference, JSON.stringify(metadata)]
    );
    if (!reservedRows[0]) {
      throw conflict(
        "You already have a business account signup payment in progress. Complete or wait for it to expire before starting a new one.",
        "SIGNUP_ALREADY_PENDING"
      );
    }

    let paymentUrl: string;
    let providerReference: string = reference;
    if (provider === "paystack") {
      const ps = await paystackInit(priceKobo, userEmail, reference, metadata);
      paymentUrl = ps.authorization_url;
      providerReference = ps.reference ?? reference;
    } else {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";
      const dd = await dodoCreateSession(priceKobo, "NGN", `${appUrl}/settings/business?created=1`, {
        ...metadata,
        reference,
      });
      paymentUrl = dd.payment_url;
      providerReference = dd.id ?? reference;
    }

    // Record the provider's own reference against the reserved row (used by
    // the webhook handler to look up this payment by provider_reference).
    if (providerReference !== reference) {
      await db.query(
        `UPDATE payments SET provider_reference = $1 WHERE id = $2`,
        [providerReference, reservedRows[0].id]
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          paymentUrl,
          reference,
          tier: "starter",
          priceKobo,
          message: "Complete payment to activate your business account",
        },
        error: null,
      },
      { status: 202 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/business
// ---------------------------------------------------------------------------

export const PATCH = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, updateBusinessSchema);

    const updates: string[] = [];
    const params: (string | null)[] = [];
    let idx = 1;

    if (body.business_name !== undefined) {
      updates.push(`business_name = $${idx++}`);
      params.push(body.business_name);
    }
    if (body.business_type !== undefined) {
      updates.push(`business_type = $${idx++}`);
      params.push(body.business_type);
    }

    if (updates.length === 0) {
      throw { status: 400, code: "BAD_REQUEST", message: "No fields to update" };
    }

    updates.push(`updated_at = NOW()`);
    params.push(userId);

    const { rows } = await db.query<BusinessAccountRow>(
      `UPDATE business_accounts
       SET ${updates.join(", ")}
       WHERE user_id = $${idx}
       RETURNING ${BUSINESS_SELECT_COLUMNS}`,
      params
    );

    if (!rows[0]) throw notFound("Business account not found");

    return NextResponse.json({
      success: true,
      data: { business: rows[0] },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
