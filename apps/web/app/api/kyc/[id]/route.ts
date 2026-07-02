export const dynamic = "force-dynamic";

/**
 * DELETE /api/kyc/[id]
 *
 * Cancel the caller's own in-flight (pending/ai_review/manual_review) KYC
 * submission. Refunds the credits charged on submission, if any.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { cancelSubmission } from "@/lib/kyc/service";

export const DELETE = withAuth<{ id: string }>(
  async (_req: NextRequest, { auth, params }) => {
    try {
      const userId = auth.user.sub;
      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

      await cancelSubmission(userId, params.id);

      return NextResponse.json({ success: true, data: { cancelled: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
