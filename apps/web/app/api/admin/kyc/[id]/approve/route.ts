export const dynamic = "force-dynamic";

/**
 * POST /api/admin/kyc/[id]/approve
 *
 * Approves a pending KYC submission — bumps the user's kyc_tier, and grants
 * the blue checkmark badge (is_verified) once badgeMinTier is met.
 * Admin or moderator.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

      const orm = await getDb();
      const [submission] = await orm
        .select({ status: schema.kycSubmissions.status })
        .from(schema.kycSubmissions)
        .where(eq(schema.kycSubmissions.id, params.id))
        .limit(1);
      if (!submission) throw notFound("KYC submission not found");
      if (!["pending", "ai_review", "manual_review"].includes(submission.status)) {
        throw conflict("This submission has already been reviewed.");
      }

      await approveSubmission(params.id, adminId);

      await orm
        .insert(schema.adminAuditLog)
        .values({
          adminId,
          action: "kyc_approve",
          resource: "kyc_submissions",
          resourceId: params.id,
        })
        .catch((err) => logger.error({ err }, "[admin:kyc] audit log write failed"));

      return NextResponse.json({ success: true, data: { status: "approved" }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
