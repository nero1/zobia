/**
 * app/api/creator/kyc/route.ts
 *
 * GET /api/creator/kyc
 *   Get caller's KYC status.
 *
 * POST /api/creator/kyc
 *   Submit KYC details.
 *   Body: { full_name, bvn_last4, bank_account_number, bank_code, bank_name }
 *   Upserts creator_kyc with status 'pending'.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const submitKycSchema = z.object({
  full_name: z.string().min(2).max(150),
  bvn_last4: z
    .string()
    .length(4)
    .regex(/^\d{4}$/, "BVN last 4 digits must be numeric"),
  bank_account_number: z
    .string()
    .min(10)
    .max(10)
    .regex(/^\d{10}$/, "Bank account number must be 10 digits"),
  bank_code: z.string().min(2).max(10),
  bank_name: z.string().min(2).max(100),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreatorKycRow {
  id: string;
  creator_id: string;
  full_name: string | null;
  bvn_last4: string | null;
  bank_account_number: string | null;
  bank_code: string | null;
  bank_name: string | null;
  kyc_status: string;
  verified_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/creator/kyc
// ---------------------------------------------------------------------------

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const { rows } = await db.query<CreatorKycRow>(
      `SELECT id, creator_id, full_name, bvn_last4, bank_account_number, bank_code,
              bank_name, kyc_status, verified_at, rejection_reason, created_at, updated_at
       FROM creator_kyc
       WHERE creator_id = $1 LIMIT 1`,
      [userId]
    );

    return NextResponse.json({
      success: true,
      data: { kyc: rows[0] ?? null },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/creator/kyc
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    // Verify caller is a creator
    const { rows: userRows } = await db.query<{ is_creator: boolean }>(
      `SELECT is_creator FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    if (!userRows[0]?.is_creator) {
      throw forbidden("Creator account required to submit KYC");
    }

    // Check existing KYC status — cannot resubmit if verified
    const { rows: existingRows } = await db.query<{ kyc_status: string }>(
      `SELECT kyc_status FROM creator_kyc WHERE creator_id = $1 LIMIT 1`,
      [userId]
    );
    if (existingRows[0]?.kyc_status === "verified") {
      throw forbidden("KYC is already verified");
    }

    const body = await validateBody(req, submitKycSchema);

    const { rows } = await db.query<CreatorKycRow>(
      `INSERT INTO creator_kyc
         (creator_id, full_name, bvn_last4, bank_account_number, bank_code, bank_name,
          kyc_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), NOW())
       ON CONFLICT (creator_id) DO UPDATE
         SET full_name = EXCLUDED.full_name,
             bvn_last4 = EXCLUDED.bvn_last4,
             bank_account_number = EXCLUDED.bank_account_number,
             bank_code = EXCLUDED.bank_code,
             bank_name = EXCLUDED.bank_name,
             kyc_status = 'pending',
             rejection_reason = NULL,
             updated_at = NOW()
       RETURNING id, creator_id, full_name, bvn_last4, bank_account_number, bank_code,
                 bank_name, kyc_status, verified_at, rejection_reason, created_at, updated_at`,
      [
        userId,
        body.full_name,
        body.bvn_last4,
        body.bank_account_number,
        body.bank_code,
        body.bank_name,
      ]
    );

    return NextResponse.json(
      { success: true, data: { kyc: rows[0] }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
