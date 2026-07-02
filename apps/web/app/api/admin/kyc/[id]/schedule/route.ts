export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/kyc/[id]/schedule
 *
 * Schedules (or reschedules/clears) the in-person physical check for a
 * Tier 3 KYC submission. Admin or moderator.
 *
 * Body: { scheduledAt: string | null (ISO datetime), notes: string | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withModeratorOrAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { scheduleTier3PhysicalCheck } from "@/lib/kyc/service";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const bodySchema = z.object({
  scheduledAt: z.string().datetime().nullable(),
  notes: z.string().max(1000).nullable(),
});

export const PATCH = withModeratorOrAdminAuth<{ id: string }>(
  async (req: NextRequest, { auth, params }) => {
    try {
      const adminId = auth.user.sub;
      await enforceRateLimit(adminId, "user", RATE_LIMITS.admin);

      const { scheduledAt, notes } = await validateBody(req, bodySchema);

      await scheduleTier3PhysicalCheck(params.id, scheduledAt, notes);

      await db.query(
        `INSERT INTO admin_audit_log (admin_id, action, resource, resource_id, after_val, created_at)
         VALUES ($1, 'kyc_schedule_physical_check', 'kyc_submissions', $2, $3::jsonb, NOW())`,
        [adminId, params.id, JSON.stringify({ scheduledAt, notes })]
      ).catch((err) => logger.error({ err }, "[admin:kyc] audit log write failed"));

      return NextResponse.json({ success: true, data: { scheduledAt, notes }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
