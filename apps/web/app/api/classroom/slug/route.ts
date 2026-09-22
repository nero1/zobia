export const dynamic = "force-dynamic";

/**
 * app/api/classroom/slug/route.ts
 *
 * GET /api/classroom/slug?name=<classroom name>
 *   → { suggestion } — a unique slug derived from the name (create form default).
 * GET /api/classroom/slug?slug=<candidate>[&roomId=<uuid>]
 *   → { slug, available, reason } — normalised candidate + availability
 *     (roomId lets a classroom "keep" or reclaim its own slug).
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, validateSearchParams } from "@/lib/api/middleware";
import { badRequest, handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { ok } from "@/lib/classroom/http";
import { checkSlugAvailability, suggestSlug } from "@/lib/classroom/slug";

const querySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  slug: z.string().trim().min(1).max(120).optional(),
  roomId: z.string().uuid().optional(),
});

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    await requireFeatureEnabled("classrooms");
    const q = validateSearchParams(req.nextUrl.searchParams, querySchema);
    if (q.slug) {
      return ok(await checkSlugAvailability(q.slug, q.roomId ?? null));
    }
    if (q.name) {
      return ok({ suggestion: await suggestSlug(q.name) });
    }
    throw badRequest("Provide either `name` or `slug`.");
  } catch (err) {
    return handleApiError(err);
  }
});
