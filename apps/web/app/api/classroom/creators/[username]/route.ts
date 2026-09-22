export const dynamic = "force-dynamic";

/**
 * app/api/classroom/creators/[username]/route.ts
 *
 * GET — "Classrooms by @username". Everyone sees the creator's public,
 * active classrooms that are opted into the listing
 * (rooms.show_in_creator_listing); the creator themself sees all of theirs
 * (hidden/archived ones flagged) so they can manage the listing.
 */

import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { badRequest, handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { ok } from "@/lib/classroom/http";
import { listCreatorClassrooms } from "@/lib/classroom/directory";

export const GET = withAuth<{ username: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    await requireFeatureEnabled("classrooms");
    const username = decodeURIComponent(params.username ?? "").replace(/^@/, "");
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(username)) throw badRequest("Invalid username");
    return ok(await listCreatorClassrooms(username, auth.user.sub));
  } catch (err) {
    return handleApiError(err);
  }
});
