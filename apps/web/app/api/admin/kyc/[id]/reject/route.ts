export const dynamic = "force-dynamic";

/**
 * POST /api/admin/kyc/[id]/reject
 *
 * Rejects a pending KYC submission with a reason shown to the user, and
 * refunds any credits charged on submission. Admin or moderator.
 *
 * Body: { reason: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withModeratorOrAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { rejectSubmission } from "@/lib/kyc/service";
import { logger } from "@/lib/logger";

const bodySchema = z.object({ reason: z.string().min(1).max(500) });

export const POST = withModeratorOrAdminAuth<{ id: string }>(
  async (req: NextRequest, { auth, params }) => {
    try {
      const adminId = auth.user.sub;
      await enforceRateLimit(adminId, "user", RATE_LIMITS.admin);

      const { reason } = await validateBody(req, bodySchema);

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

      await rejectSubmission(params.id, adminId, reason);

      await orm
        .insert(schema.adminAuditLog)
        .values({
          adminId,
          action: "kyc_reject",
          resource: "kyc_submissions",
          resourceId: params.id,
          afterVal: { reason },
        })
        .catch((err) => logger.error({ err }, "[admin:kyc] audit log write failed"));

      return NextResponse.json({ success: true, data: { status: "rejected" }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
