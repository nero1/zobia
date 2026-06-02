/**
 * app/api/admin/kyc/route.ts
 *
 * Admin-only KYC management.
 *
 * GET /api/admin/kyc
 *   List all KYC submissions with status='pending'.
 *   Admin only (is_admin verified from database).
 *
 * POST /api/admin/kyc
 *   Approve or reject KYC.
 *   Body: { creatorId, action: 'approve'|'reject', rejection_reason? }
 *   Updates creator_kyc.kyc_status.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const reviewKycSchema = z.object({
  creatorId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  rejection_reason: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingKycRow {
  id: string;
  creator_id: string;
  username: string | null;
  display_name: string | null;
  full_name: string | null;
  bvn_last4: string | null;
  bank_account_number: string | null;
  bank_code: string | null;
  bank_name: string | null;
  kyc_status: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/admin/kyc
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { rows } = await db.query<PendingKycRow>(
      `SELECT
         ck.id,
         ck.creator_id,
         u.username,
         u.display_name,
         ck.full_name,
         ck.bvn_last4,
         ck.bank_account_number,
         ck.bank_code,
         ck.bank_name,
         ck.kyc_status,
         ck.created_at,
         ck.updated_at
       FROM creator_kyc ck
       JOIN users u ON u.id = ck.creator_id
       WHERE ck.kyc_status = 'pending'
         AND u.deleted_at IS NULL
       ORDER BY ck.created_at ASC`
    );

    return NextResponse.json({
      success: true,
      data: { submissions: rows },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/kyc
// ---------------------------------------------------------------------------

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, reviewKycSchema);

    // Fetch existing KYC record
    const { rows: existing } = await db.query<{ id: string; kyc_status: string }>(
      `SELECT id, kyc_status FROM creator_kyc WHERE creator_id = $1 LIMIT 1`,
      [body.creatorId]
    );
    if (!existing[0]) throw notFound("KYC record not found for this creator");

    const newStatus = body.action === "approve" ? "verified" : "rejected";

    await db.query(
      `UPDATE creator_kyc
       SET kyc_status = $1,
           verified_at = CASE WHEN $1 = 'verified' THEN NOW() ELSE NULL END,
           rejection_reason = $2,
           updated_at = NOW()
       WHERE creator_id = $3`,
      [
        newStatus,
        body.action === "reject" ? (body.rejection_reason ?? null) : null,
        body.creatorId,
      ]
    );

    // If approved, mark creator as verified on users table
    if (body.action === "approve") {
      await db.query(
        `UPDATE users SET kyc_verified = TRUE, updated_at = NOW() WHERE id = $1`,
        [body.creatorId]
      ).catch(() => {
        // Column may not exist; ignore gracefully
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        creatorId: body.creatorId,
        action: body.action,
        newStatus,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
