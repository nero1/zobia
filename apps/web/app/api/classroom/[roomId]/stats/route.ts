export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/stats/route.ts
 *
 * GET — creator-panel analytics for one classroom. Depth (basic / more /
 * detailed) follows the creator's plan and creator tier
 * (lib/classroom/limits.ts). Creator or staff only. Cached 15s memory + 60s
 * Redis like GET /api/creator/dashboard.
 */

import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { classroomContextFromParams, ok } from "@/lib/classroom/http";
import { resolveClassroomStatsTier } from "@/lib/classroom/limits";
import { getClassroomStats } from "@/lib/classroom/stats";

export const GET = withAuth<{ roomId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "manageClassroom");
    // Tier follows the classroom CREATOR's plan (staff viewing see what the creator sees).
    const orm = await getDb();
    const [creatorRow] = await orm
      .select({ plan: schema.users.plan, creator_tier: schema.users.creatorTier })
      .from(schema.users)
      .where(eq(schema.users.id, classroom.creatorId))
      .limit(1);
    const tier = resolveClassroomStatsTier(creatorRow?.plan, creatorRow?.creator_tier);
    return ok(await getClassroomStats(classroom.id, tier));
  } catch (err) {
    return handleApiError(err);
  }
});
