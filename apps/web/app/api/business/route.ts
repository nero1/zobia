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
 *   Create a business account. One per user.
 *
 * PATCH /api/business
 *   Update business account details.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, notFound, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createBusinessSchema = z.object({
  business_name: z.string().min(2).max(120),
  business_type: z.string().max(80).optional(),
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
  subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/business
// ---------------------------------------------------------------------------

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const { rows } = await db.query<BusinessAccountRow>(
      `SELECT id, user_id, business_name, business_type, tier, verified, status,
              subscription_id, created_at, updated_at
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
// POST /api/business
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

    const { rows } = await db.query<BusinessAccountRow>(
      `INSERT INTO business_accounts
         (user_id, business_name, business_type, tier, verified, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'starter', FALSE, 'active', NOW(), NOW())
       RETURNING id, user_id, business_name, business_type, tier, verified, status,
                 subscription_id, created_at, updated_at`,
      [userId, body.business_name, body.business_type ?? null]
    );

    return NextResponse.json(
      { success: true, data: { business: rows[0] }, error: null },
      { status: 201 }
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
       RETURNING id, user_id, business_name, business_type, tier, verified, status,
                 subscription_id, created_at, updated_at`,
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
