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
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, conflict, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { raiseAlert } from "@/lib/alerts/dispatch";

// ---------------------------------------------------------------------------
// POST /api/business/verify
// ---------------------------------------------------------------------------

export const POST = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("businessAccounts");
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    const orm = await getDb();
    const rows = await orm
      .select({ id: schema.businessAccounts.id, verificationStatus: schema.businessAccounts.verificationStatus })
      .from(schema.businessAccounts)
      .where(eq(schema.businessAccounts.userId, userId))
      .limit(1);

    if (!rows[0]) throw notFound("Business account not found");

    const { id, verificationStatus } = rows[0];

    if (verificationStatus === "pending") {
      throw conflict("A verification request is already pending");
    }
    if (verificationStatus === "verified") {
      throw conflict("This business account is already verified");
    }

    await orm
      .update(schema.businessAccounts)
      .set({
        verificationStatus: "pending",
        verificationRequestedAt: new Date(),
        verificationReviewedAt: null,
        verificationRejectReason: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.businessAccounts.id, id));

    // Alert admin of new verification request
    await raiseAlert(orm, {
      type: "business_verification_request",
      category: "other",
      priorityLevel: 6,
      title: "Business verification request",
      message: `Business account ${id} requested verification`,
      metadata: { businessAccountId: id, userId },
      dedupeKey: `business_verification_request:${id}`,
    }).catch(() => {});

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

    const orm = await getDb();
    const rows = await orm
      .select({ id: schema.businessAccounts.id, verificationStatus: schema.businessAccounts.verificationStatus })
      .from(schema.businessAccounts)
      .where(eq(schema.businessAccounts.userId, userId))
      .limit(1);
    if (!rows[0]) throw notFound("Business account not found");
    if (rows[0].verificationStatus !== "pending") {
      throw badRequest("No pending verification request to cancel");
    }

    await orm
      .update(schema.businessAccounts)
      .set({ verificationStatus: "unverified", verificationRequestedAt: null, updatedAt: new Date() })
      .where(eq(schema.businessAccounts.id, rows[0].id));

    return NextResponse.json({
      success: true,
      data: { verification_status: "unverified" },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
