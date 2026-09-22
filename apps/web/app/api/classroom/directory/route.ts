export const dynamic = "force-dynamic";

/**
 * app/api/classroom/directory/route.ts
 *
 * GET /api/classroom/directory?q=&category=&price=all|free|paid&sort=popular|new&offset=
 *
 * Searchable directory of public, active classrooms (boosted classrooms
 * first). Returns the shared ClassroomCard shape used by the web Browse tab,
 * the creator listing page and the Android app. `categories` is included on
 * the first page for the filter chips.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { ok } from "@/lib/classroom/http";
import { directoryCategories, searchDirectory } from "@/lib/classroom/directory";

const querySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(50).optional(),
  price: z.enum(["all", "free", "paid"]).optional(),
  sort: z.enum(["popular", "new"]).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    await requireFeatureEnabled("classrooms");
    const q = validateSearchParams(req.nextUrl.searchParams, querySchema);
    const [result, categories] = await Promise.all([
      searchDirectory(auth.user.sub, q),
      (q.offset ?? 0) === 0 ? directoryCategories() : Promise.resolve(null),
    ]);
    return ok({ ...result, categories });
  } catch (err) {
    return handleApiError(err);
  }
});
