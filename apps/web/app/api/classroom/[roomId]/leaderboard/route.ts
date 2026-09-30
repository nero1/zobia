export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/leaderboard/route.ts
 *
 * GET ?period=7d|30d|all — this classroom's own points leaderboard plus the
 * caller's standing, level ladder and badges. Members only: classroom
 * standings are never exposed platform-wide.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability } from "@/lib/classroom/access";
import { classroomContextFromParams, ok } from "@/lib/classroom/http";
import { getClassroomLeaderboard, getMemberStanding } from "@/lib/classroom/gamification";
import { CLASSROOM_BADGES, CLASSROOM_LEVEL_THRESHOLDS } from "@/lib/classroom/levels";
import { levelName } from "@/lib/classroom/settings";
import { maskLeaderboardRow, ANONYMOUS_CAMEL_IDENTITY } from "@/lib/privacy/leaderboardAnonymity";

const querySchema = z.object({ period: z.enum(["7d", "30d", "all"]).optional() });

export const GET = withAuth<{ roomId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "viewMemberContent");
    const { period = "all" } = validateSearchParams(req.nextUrl.searchParams, querySchema);
    const [entries, me] = await Promise.all([
      getClassroomLeaderboard(classroom.id, period, 50),
      getMemberStanding(classroom.id, auth.user.sub),
    ]);
    // Members may hide their name (paid privacy setting). The board is
    // members-only and cached viewer-independently, so identity is masked here
    // per viewer: everyone sees "Anonymous"; the classroom's own admins
    // (creator / moderators / staff) also get the real identity behind a
    // "Reveal" control.
    const canReveal = viewer.can.manageMembers;
    const maskedEntries = entries.map(({ isAnonymous, ...entry }, i) =>
      maskLeaderboardRow(entry, {
        anonymous: isAnonymous,
        isSelf: entry.userId === auth.user.sub,
        canReveal,
        idKey: "userId",
        masked: { ...ANONYMOUS_CAMEL_IDENTITY, avatarUrl: null },
        anonId: `anon-${i}`,
      })
    );
    return ok({
      period,
      entries: maskedEntries,
      me,
      levels: CLASSROOM_LEVEL_THRESHOLDS.map((min, i) => ({ level: i + 1, name: levelName(classroom.settings, i + 1), minPoints: min })),
      badgeCatalog: Object.values(CLASSROOM_BADGES),
    });
  } catch (err) {
    return handleApiError(err);
  }
});
