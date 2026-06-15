export const dynamic = 'force-dynamic';

/**
 * app/api/business/verify/route.ts
 *
 * POST /api/business/verify
 *   Submit a verification request for the caller's business account.
 *   Moves verification_status from 'unverified' or 'rejected' → 'pending'.
 *
 * DELETE /api/business/verify
 *   Cancel a pending verification request (resets to 'unverified').
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, conflict, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// POST /api/business/verify
// ---------------------------------------------------------------------------

export const POST = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    const { rows } = await db.query<{
      id: string;
      verification_status: string;
    }>(
      `SELECT id, verification_status
       FROM business_accounts
       WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    if (!rows[0]) throw notFound("Business account not found");

    const { id, verification_status } = rows[0];

    if (verification_status === "pending") {
      throw conflict("A verification request is already pending");
    }
    if (verification_status === "verified") {
      throw conflict("This business account is already verified");
    }

    await db.query(
      `UPDATE business_accounts
       SET verification_status = 'pending',
           verification_requested_at = NOW(),
           verification_reviewed_at = NULL,
           verification_reject_reason = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    // Alert admin of new verification request
    await db.query(
      `INSERT INTO system_alerts
         (type, severity, message, metadata, created_at)
       VALUES ('business_verification_request', 'low', $1, $2::jsonb, NOW())`,
      [
        `Business account ${id} requested verification`,
        JSON.stringify({ businessAccountId: id, userId }),
      ]
    ).catch(() => {});

    return NextResponse.json({
      success: true,
      data: { verification_status: "pending" },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/business/verify  — cancel pending request
// ---------------------------------------------------------------------------

export const DELETE = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const { rows } = await db.query<{ id: string; verification_status: string }>(
      `SELECT id, verification_status FROM business_accounts WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (!rows[0]) throw notFound("Business account not found");
    if (rows[0].verification_status !== "pending") {
      throw badRequest("No pending verification request to cancel");
    }

    await db.query(
      `UPDATE business_accounts
       SET verification_status = 'unverified',
           verification_requested_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [rows[0].id]
    );

    return NextResponse.json({
      success: true,
      data: { verification_status: "unverified" },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
