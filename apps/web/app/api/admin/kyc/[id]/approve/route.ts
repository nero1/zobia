export const dynamic = "force-dynamic";

/**
 * POST /api/admin/kyc/[id]/approve
 *
 * Approves a pending KYC submission — bumps the user's kyc_tier, and grants
 * the blue checkmark badge (is_verified) once badgeMinTier is met.
 * Admin or moderator.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { approveSubmission } from "@/lib/kyc/service";
import { logger } from "@/lib/logger";

export const POST = withModeratorOrAdminAuth<{ id: string }>(
  async (_req: NextRequest, { auth, params }) => {
    try {
      const adminId = auth.user.sub;
      await enforceRateLimit(adminId, "user", RATE_LIMITS.admin);

      const { rows } = await db.query<{ status: string }>(
        `SELECT status FROM kyc_submissions WHERE id = $1`,
        [params.id]
      );
      if (!rows[0]) throw notFound("KYC submission not found");
      if (!["pending", "ai_review", "manual_review"].includes(rows[0].status)) {
        throw conflict("This submission has already been reviewed.");
      }

      await approveSubmission(params.id, adminId);

      await db.query(
        `INSERT INTO admin_audit_log (admin_id, action, resource, resource_id, created_at)
         VALUES ($1, 'kyc_approve', 'kyc_submissions', $2, NOW())`,
        [adminId, params.id]
      ).catch((err) => logger.error({ err }, "[admin:kyc] audit log write failed"));

      return NextResponse.json({ success: true, data: { status: "approved" }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
