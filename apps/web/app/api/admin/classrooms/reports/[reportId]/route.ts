export const dynamic = "force-dynamic";

/**
 * app/api/admin/classrooms/reports/[reportId]/route.ts
 *
 * PATCH { action: 'remove' | 'dismiss', note? } — staff resolution of a
 * classroom community report (any classroom).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withModeratorOrAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertUuid } from "@/lib/classroom/http";
import { resolveReport } from "@/lib/classroom/community";

const patchSchema = z.object({
  action: z.enum(["remove", "dismiss"]),
  note: z.string().trim().max(500).optional().nullable(),
});

export const PATCH = withModeratorOrAdminAuth<{ reportId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, patchSchema);
    await resolveReport({
      reportId: assertUuid(params.reportId, "Report"),
      roomId: null,
      action: body.action,
      resolverId: auth.user.sub,
      note: body.note,
    });
    return NextResponse.json({ success: true, data: { resolved: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
