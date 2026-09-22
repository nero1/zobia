export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/slug/route.ts
 *
 * GET  /api/classroom/:roomId/slug — current slug, change quote (cost,
 *      cooldown, free changes left) under this classroom's policy, and history.
 * POST /api/classroom/:roomId/slug — change the slug. Body:
 *      { slug, expectedCostCredits } — the cost the creator confirmed; the
 *      server re-quotes inside the transaction and refuses on mismatch.
 *
 * Creator only. Rate-limited (money-moving + SEO-affecting).
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { classroomContextFromParams, ok } from "@/lib/classroom/http";
import { changeClassroomSlug, getSlugChangeQuote, getSlugHistory } from "@/lib/classroom/slug";

const changeSchema = z.object({
  slug: z.string().trim().min(1).max(120),
  expectedCostCredits: z.number().int().min(0),
});

export const GET = withAuth<{ roomId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "manageClassroom");
    const [quote, history] = await Promise.all([
      getSlugChangeQuote(classroom.id, classroom.settings),
      getSlugHistory(classroom.id),
    ]);
    return ok({ slug: classroom.slug, quote, history });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ roomId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomSlugChange);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    // Only the actual creator changes the slug (they are the one charged).
    requireCapability(viewer, "manageClassroom");
    const body = await validateBody(req, changeSchema);
    const result = await changeClassroomSlug({
      roomId: classroom.id,
      actorId: auth.user.sub,
      newSlug: body.slug,
      expectedCostCredits: body.expectedCostCredits,
    });
    return ok(result);
  } catch (err) {
    return handleApiError(err);
  }
});
