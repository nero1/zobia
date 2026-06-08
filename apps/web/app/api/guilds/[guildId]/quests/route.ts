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
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuestRow {
  id: string;
  guild_id: string;
  title: string;
  description: string;
  quest_type: string;
  target_count: number;
  current_count: number;
  reward_guild_xp: number;
  reward_coins: number;
  week_start: string;
  week_end: string;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
}

interface ContributionCountRow {
  quest_id: string;
  user_contribution: number;
}

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
  userId: string,
  guildId: string
): Promise<{ role: string }> {
  const guildCheck = await db.query<{ id: string }>(
    `SELECT id FROM guilds WHERE id = $1 AND is_active = TRUE`,
    [guildId]
  );
  if (!guildCheck.rows[0]) throw notFound("Guild not found");

  const memberCheck = await db.query<{ role: string }>(
    `SELECT role FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId]
  );
  if (!memberCheck.rows[0]) throw forbidden("You are not a member of this guild");

  return memberCheck.rows[0];
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

      await verifyGuildMember(userId, guildId);

      // Fetch current week's quests
      const questsResult = await db.query<QuestRow>(
        `SELECT id, guild_id, title, description, quest_type, target_count,
                current_count, reward_guild_xp, reward_coins, week_start, week_end,
                is_completed, completed_at, created_at
         FROM guild_quests
         WHERE guild_id = $1
           AND week_start <= NOW()
           AND week_end >= NOW()
         ORDER BY created_at ASC`,
        [guildId]
      );

      const quests = questsResult.rows;

      if (quests.length === 0) {
        return NextResponse.json({
          success: true,
          data: { quests: [], guildId },
          error: null,
        });
      }

      // Fetch caller's contribution counts for all quests in one query
      const questIds = quests.map((q) => q.id);
      const contribResult = await db.query<ContributionCountRow>(
        `SELECT quest_id, SUM(amount)::int AS user_contribution
         FROM guild_quest_contributions
         WHERE quest_id = ANY($1) AND user_id = $2
         GROUP BY quest_id`,
        [questIds, userId]
      );

      const contribMap = new Map<string, number>();
      for (const row of contribResult.rows) {
        contribMap.set(row.quest_id, row.user_contribution);
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

      // Check membership and role
      const member = await verifyGuildMember(userId, guildId);

      // Check if caller is admin
      const adminCheck = await db.query<{ is_admin: boolean }>(
        `SELECT is_admin FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId]
      );
      const isAdmin = adminCheck.rows[0]?.is_admin ?? false;

      if (member.role !== "leader" && !isAdmin) {
        throw forbidden("Only the guild captain or an admin can create quests");
      }

      const body = await validateBody(req, createQuestSchema);

      // Validate week range
      const weekStart = new Date(body.weekStart);
      const weekEnd = new Date(body.weekEnd);
      if (weekEnd <= weekStart) {
        throw badRequest("weekEnd must be after weekStart");
      }

      const insertResult = await db.query<{ id: string }>(
        `INSERT INTO guild_quests
           (guild_id, title, description, target_count, reward_guild_xp, reward_coins,
            week_start, week_end, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         RETURNING id`,
        [
          guildId,
          body.title,
          body.description,
          body.targetCount,
          body.rewardGuildXP,
          body.rewardCoins,
          body.weekStart,
          body.weekEnd,
        ]
      );

      const quest = insertResult.rows[0];

      return NextResponse.json(
        { success: true, data: { questId: quest.id, guildId }, error: null },
        { status: 201 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);
