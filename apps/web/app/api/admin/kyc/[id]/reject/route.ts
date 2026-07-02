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
import { db } from "@/lib/db";
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

      const { rows } = await db.query<{ status: string }>(
        `SELECT status FROM kyc_submissions WHERE id = $1`,
        [params.id]
      );
      if (!rows[0]) throw notFound("KYC submission not found");
      if (!["pending", "ai_review", "manual_review"].includes(rows[0].status)) {
        throw conflict("This submission has already been reviewed.");
      }

      await rejectSubmission(params.id, adminId, reason);

      await db.query(
        `INSERT INTO admin_audit_log (admin_id, action, resource, resource_id, after_val, created_at)
         VALUES ($1, 'kyc_reject', 'kyc_submissions', $2, $3::jsonb, NOW())`,
        [adminId, params.id, JSON.stringify({ reason })]
      ).catch((err) => logger.error({ err }, "[admin:kyc] audit log write failed"));

      return NextResponse.json({ success: true, data: { status: "rejected" }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
