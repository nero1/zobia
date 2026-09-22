export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/reports/route.ts
 *
 * GET  ?status=pending|resolved — the classroom's report queue
 *      (creator, moderators with handleReports, staff)
 * POST { postId | commentId, reason, details? } — a member reports content.
 *      Three pending reports on the same item escalate it to platform staff
 *      (/gate44/classrooms).
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { badRequest, handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { classroomContextFromParams, ok } from "@/lib/classroom/http";
import { createReport, listReports, REPORT_REASONS } from "@/lib/classroom/community";

const listSchema = z.object({ status: z.enum(["pending", "resolved"]).optional() });

const createSchema = z.object({
  postId: z.string().uuid().optional(),
  commentId: z.string().uuid().optional(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).optional().nullable(),
});

export const GET = withAuth<{ roomId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "handleReports");
    const q = validateSearchParams(req.nextUrl.searchParams, listSchema);
    return ok({ reports: await listReports(classroom.id, q.status ?? "pending") });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ roomId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "report");
    const body = await validateBody(req, createSchema);
    if (!!body.postId === !!body.commentId) throw badRequest("Report exactly one post or comment.");
    const target = body.postId
      ? ({ kind: "post", id: body.postId } as const)
      : ({ kind: "comment", id: body.commentId! } as const);
    return ok(await createReport(classroom, viewer, { target, reason: body.reason, details: body.details }), 201);
  } catch (err) {
    return handleApiError(err);
  }
});
