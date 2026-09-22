export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/lessons/[moduleId]/complete/route.ts
 *
 * POST   — mark a lesson complete (awards classroom points + a Knowledge XP
 *          bonus; completing every lesson awards the course bonus + badge)
 * DELETE — un-mark it (progress aid only; points are not clawed back)
 */

import { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { badRequest, handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { classroomContextFromParams, ok } from "@/lib/classroom/http";
import { completeLesson, uncompleteLesson } from "@/lib/classroom/curriculum";
import { fireKnowledgeBonuses, getMemberStanding } from "@/lib/classroom/gamification";

function moduleIdFrom(params: { moduleId?: string }): string {
  const id = params.moduleId ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw badRequest("Invalid lesson id");
  return id;
}

export const POST = withAuth<{ roomId: string; moduleId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomVote);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "completeLessons");
    const moduleId = moduleIdFrom(params);
    const standing = await getMemberStanding(classroom.id, auth.user.sub);
    const result = await completeLesson({
      roomId: classroom.id,
      userId: auth.user.sub,
      moduleId,
      memberLevel: standing.level,
      fullAccess: viewer.isCreator || viewer.isModerator || viewer.isStaff,
      classroom: { slug: classroom.slug, name: classroom.name },
    });
    fireKnowledgeBonuses(result.awards);
    return ok({
      completed: true,
      alreadyCompleted: result.alreadyCompleted,
      completedCount: result.completedCount,
      totalCount: result.totalCount,
      pointsAwarded: result.awards.reduce((s, a) => s + a.awarded, 0),
      newBadges: result.awards.flatMap((a) => a.newBadges),
      leveledUp: result.awards.some((a) => a.leveledUp),
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ roomId: string; moduleId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.classroomVote);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "completeLessons");
    await uncompleteLesson(classroom.id, auth.user.sub, moduleIdFrom(params));
    return ok({ completed: false });
  } catch (err) {
    return handleApiError(err);
  }
});
