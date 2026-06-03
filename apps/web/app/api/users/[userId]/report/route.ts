/**
 * app/api/users/[userId]/report/route.ts
 *
 * POST /api/users/[userId]/report
 *
 * Convenience endpoint for reporting a user directly from their profile screen.
 * Body: { reason: string }
 * Response always 200 — reporter never learns moderation outcome.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";
import { classifyReport, type ReportType } from "@/lib/moderation/aiClassifier";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  reason: z.string().min(1).max(200),
});

// Must match moderation_reports.report_type accepted values
const REASON_TO_TYPE: Record<string, ReportType> = {
  Harassment:              "harassment",
  Spam:                    "spam",
  "Fake Account":          "other",
  "Inappropriate Content": "sexual_content",
  Other:                   "other",
};

interface UserParams {
  userId: string;
}

export const POST = withAuth<UserParams>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { userId } = params;
    if (!UUID_RE.test(userId)) throw badRequest("userId must be a valid UUID");
    if (userId === auth.user.sub) throw badRequest("You cannot report yourself");

    const body = bodySchema.parse(await req.json());
    const reportType: ReportType = REASON_TO_TYPE[body.reason] ?? "other";

    await db.query(
      `INSERT INTO moderation_reports
         (reporter_id, reported_user_id, report_type, description, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW())`,
      [auth.user.sub, userId, reportType, body.reason]
    );

    // Non-blocking AI classification
    classifyReport(body.reason, reportType).catch(() => {});

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
