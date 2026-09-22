export const dynamic = "force-dynamic";

/**
 * app/api/classroom/resolve/[identifier]/route.ts
 *
 * GET — resolve a /c/<slug> identifier (current slug, retired slug or UUID)
 * to the classroom id for in-app deep links and notification taps (the
 * Capacitor Android app's /c/$slug screen). Unlike the anonymous
 * /api/public/resolve, this also resolves private/archived classrooms — but
 * only for the viewer's own classrooms (member, moderator, creator, staff).
 */

import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { loadClassroomContext } from "@/lib/classroom/access";
import { ok } from "@/lib/classroom/http";
import { resolveClassroomIdentifier } from "@/lib/classroom/resolve";

export const GET = withAuth<{ identifier: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    await requireFeatureEnabled("classrooms");
    const identifier = decodeURIComponent(params.identifier ?? "").slice(0, 120);
    const resolved = identifier ? await resolveClassroomIdentifier(identifier) : null;
    if (!resolved) throw notFound("Classroom not found");
    const { classroom, viewer } = await loadClassroomContext({ id: resolved.id }, auth.user.sub);
    if ((!classroom.isPublic || !classroom.isActive) && !viewer.can.viewMemberContent) throw notFound("Classroom not found");
    return ok({ id: classroom.id, slug: classroom.slug });
  } catch (err) {
    return handleApiError(err);
  }
});
