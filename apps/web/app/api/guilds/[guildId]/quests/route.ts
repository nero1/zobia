export const dynamic = 'force-dynamic';

/**
 * app/api/guilds/[guildId]/quests/route.ts
 *
 * Guild Quests endpoints.
 *
 * GET /api/guilds/[guildId]/quests
 *   - Returns the current week's guild quests with progress and the caller's contribution.
 *   - Requires caller to be a guild member.
 *
 * POST /api/guilds/[guildId]/quests
 *   - Creates a new guild quest (guild captain or admin only).
 *   - Body: { title, description, targetCount, rewardGuildXP, rewardCoins, weekStart, weekEnd }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const createQuestSchema = z.object({
  title: z.string().min(3).max(100),
  description: z.string().min(1).max(500),
  targetCount: z.number().int().positive().min(1),
  rewardGuildXP: z.number().int().nonnegative().default(500),
  rewardCoins: z.number().int().nonnegative().default(200),
  weekStart: z.string().datetime(),
  weekEnd: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verify that the user is a member of the specified guild.
 * Throws 403 if not a member, 404 if guild not found.
 */
async function verifyGuildMember(
  orm: DbOrTx,
  userId: string,
  guildId: string
): Promise<{ role: string }> {
  const guildCheck = await orm
    .select({ id: schema.guilds.id })
    .from(schema.guilds)
    .where(and(eq(schema.guilds.id, guildId), eq(schema.guilds.isActive, true)))
    .limit(1);
  if (!guildCheck[0]) throw notFound("Guild not found");

  const memberCheck = await orm
    .select({ role: schema.guildMembers.role })
    .from(schema.guildMembers)
    .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, userId)))
    .limit(1);
  if (!memberCheck[0]) throw forbidden("You are not a member of this guild");

  return memberCheck[0];
}

// ---------------------------------------------------------------------------
// GET /api/guilds/[guildId]/quests
// ---------------------------------------------------------------------------

/**
 * Return the current week's quests with progress and per-user contribution counts.
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: Promise<{ guildId: string }>; auth: { user: { sub: string } } }
  ) => {
    try {
      const { guildId } = await params;
      const userId = auth.user.sub;

      await enforceRateLimit(userId, "user", RATE_LIMITS.apiRead);
      const orm = await getDb();

      await verifyGuildMember(orm, userId, guildId);

      // Fetch current week's quests
      const quests = await orm
        .select({
          id: schema.guildQuests.id,
          guildId: schema.guildQuests.guildId,
          title: schema.guildQuests.title,
          description: schema.guildQuests.description,
          questType: schema.guildQuests.questType,
          targetCount: schema.guildQuests.targetCount,
          currentCount: schema.guildQuests.currentCount,
          rewardGuildXp: schema.guildQuests.rewardGuildXp,
          rewardCoins: schema.guildQuests.rewardCoins,
          weekStart: schema.guildQuests.weekStart,
          weekEnd: schema.guildQuests.weekEnd,
          isCompleted: schema.guildQuests.isCompleted,
          completedAt: schema.guildQuests.completedAt,
          createdAt: schema.guildQuests.createdAt,
        })
        .from(schema.guildQuests)
        .where(
          and(
            eq(schema.guildQuests.guildId, guildId),
            lte(schema.guildQuests.weekStart, sql`NOW()`),
            gte(schema.guildQuests.weekEnd, sql`NOW()`)
          )
        )
        .orderBy(schema.guildQuests.createdAt);

      if (quests.length === 0) {
        return NextResponse.json({
          success: true,
          data: { quests: [], guildId },
          error: null,
        });
      }

      // Fetch caller's contribution counts for all quests in one query
      const questIds = quests.map((q) => q.id);
      const contribResult = await orm
        .select({
          questId: schema.guildQuestContributions.questId,
          userContribution: sql<number>`SUM(${schema.guildQuestContributions.amount})::int`,
        })
        .from(schema.guildQuestContributions)
        .where(
          and(
            inArray(schema.guildQuestContributions.questId, questIds),
            eq(schema.guildQuestContributions.userId, userId)
          )
        )
        .groupBy(schema.guildQuestContributions.questId);

      const contribMap = new Map<string, number>();
      for (const row of contribResult) {
        contribMap.set(row.questId, row.userContribution);
      }

      const questsWithContrib = quests.map((q) => ({
        ...q,
        userContribution: contribMap.get(q.id) ?? 0,
      }));

      return NextResponse.json({
        success: true,
        data: { quests: questsWithContrib, guildId },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/guilds/[guildId]/quests
// ---------------------------------------------------------------------------

/**
 * Create a new guild quest. Only the guild captain (leader) or an admin can create quests.
 */
export const POST = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: Promise<{ guildId: string }>; auth: { user: { sub: string } } }
  ) => {
    try {
      const { guildId } = await params;
      const userId = auth.user.sub;

      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);
      const orm = await getDb();

      // Check membership and role
      const member = await verifyGuildMember(orm, userId, guildId);

      // Check if caller is admin
      const adminCheck = await orm
        .select({ isAdmin: schema.users.isAdmin })
        .from(schema.users)
        .where(and(eq(schema.users.id, userId), sql`${schema.users.deletedAt} IS NULL`))
        .limit(1);
      const isAdmin = adminCheck[0]?.isAdmin ?? false;

      if (member.role !== "leader" && !isAdmin) {
        throw forbidden("Only the guild captain or an admin can create quests");
      }

      const body = await validateBody(req, createQuestSchema);

      // Validate week range
      const weekStart = new Date(body.weekStart);
      const weekEnd = new Date(body.weekEnd);
      if (weekStart.getUTCDay() !== 1) {
        throw badRequest("Guild quest week_start must be a Monday (UTC)", "INVALID_WEEK_START");
      }
      if (weekEnd <= weekStart) {
        throw badRequest("weekEnd must be after weekStart");
      }

      const insertResult = await orm
        .insert(schema.guildQuests)
        .values({
          guildId,
          title: body.title,
          description: body.description,
          targetCount: body.targetCount,
          rewardGuildXp: body.rewardGuildXP,
          rewardCoins: body.rewardCoins,
          weekStart,
          weekEnd,
        })
        .returning({ id: schema.guildQuests.id });

      const quest = insertResult[0];

      return NextResponse.json(
        { success: true, data: { questId: quest.id, guildId }, error: null },
        { status: 201 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);
