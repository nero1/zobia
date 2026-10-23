import { questActionPath } from "@zobia/shared/utils";
import { checkWikiCreationEligibility } from "@/lib/wiki/limits";
import { loadManifest } from "@/lib/manifest";
import { getRankForXP, xpForRankNumber } from "@/lib/xp/engine";
export const dynamic = 'force-dynamic';

/**
 * app/api/quests/daily/route.ts
 *
 * Daily quest deck endpoints.
 *
 * GET  /api/quests/daily
 *   Returns today's quest deck for the authenticated user.
 *   Each quest includes the user's current progress.
 *
 * POST /api/quests/daily/[questId]/progress
 *   Updates quest progress (increments counter, marks complete if target reached).
 *   Note: the progress POST lives in ./[questId]/progress/route.ts – this file
 *   handles only the GET for the deck list.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { generateDailyDeck } from "@/lib/quests/questEngine";
import type { Plan } from "@zobia/types";

// ---------------------------------------------------------------------------
// GET /api/quests/daily
// ---------------------------------------------------------------------------

/**
 * Return today's quest deck for the authenticated user.
 *
 * Delegates to lib/quests/questEngine.generateDailyDeck so the deck is
 * actually persisted to `user_quest_decks`. Without this, action routes that
 * call triggerActivityQuestProgress() would never find the quest in the
 * user's deck and progress would silently never advance (BUG: quests always
 * showed 0/x because the deck the client saw here and the deck membership
 * check in updateQuestProgress() referenced two different, disconnected
 * quest lists).
 *
 * @returns JSON { date: string, quests: QuestDeckItem[] }
 */
export const GET = withAuth(async (req, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const orm = await getDb();
    const [planRow] = await orm
      .select({ plan: schema.users.plan, levelCreator: schema.users.levelCreator, xpTotal: schema.users.xpTotal, isAdmin: schema.users.isAdmin, isModerator: schema.users.isModerator })
      .from(schema.users)
      .where(and(eq(schema.users.id, auth.user.sub), isNull(schema.users.deletedAt)))
      .limit(1);
    const plan: Plan = (planRow?.plan as Plan | undefined) ?? "free";

    const [wiki, manifest, ownedBlogs] = await Promise.all([
      checkWikiCreationEligibility({ plan, levelCreator: planRow?.levelCreator ?? 0, isAdmin: planRow?.isAdmin ?? false, isModerator: planRow?.isModerator ?? false }),
      loadManifest(),
      orm.select({ id: schema.blogs.id }).from(schema.blogs).where(and(eq(schema.blogs.ownerId, auth.user.sub), isNull(schema.blogs.deletedAt))).limit(1),
    ]);
    const excluded: string[] = [];
    if (!wiki.eligible) excluded.push("wiki_edit");
    if (!ownedBlogs.length) excluded.push("blog_publish");
    if (getRankForXP(Number(planRow?.xpTotal ?? 0)).rankNumber < manifest.polls.minLevelToCreate) excluded.push("poll_create");
    const quests = (await generateDailyDeck(auth.user.sub, plan, orm, excluded)).map((quest) => ({ ...quest, actionUrl: questActionPath(quest.action_type) }));
    const today = new Date().toISOString().slice(0, 10);

    const completedCount = quests.filter((q) => q.completed).length;
    return NextResponse.json(
      {
        date: today,
        xpToLevel2: Math.max(0, xpForRankNumber(2) - Number(planRow?.xpTotal ?? 0)),
        quests,
        total: quests.length,
        completed: completedCount,
        bonus_unlocked: quests.length > 0 && completedCount === quests.length,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
