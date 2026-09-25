export const dynamic = "force-dynamic";

/**
 * app/api/admin/games
 *
 * GET  — list every game (active + inactive) with summary stats.
 * POST — create a new game (cover page + reward/play-cost config).
 *
 * Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { games, gameBestScores, gameChallenges } from "@/lib/db/schema";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { generateUniqueSlug } from "@/lib/slug";
import { GAME_CATEGORIES } from "@zobia/types";

const categoryEnum = z.enum(GAME_CATEGORIES as unknown as [string, ...string[]]);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/).optional(),
  category: categoryEnum,
  engineKey: z.string().min(1).max(60),
  tagline: z.string().max(160).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  longDescription: z.string().max(8000).optional().nullable(),
  coverEmoji: z.string().min(1).max(8).default("🎮"),
  coverImageUrl: z.string().url().max(500).optional().nullable(),
  rewardCreditsPerWin: z.number().int().min(0).default(0),
  rewardXpPerWin: z.number().int().min(0).default(0),
  rewardStarsPerWin: z.number().int().min(0).default(0),
  playCostCredits: z.number().int().min(0).default(0),
  playCostStars: z.number().int().min(0).default(0),
  maxScore: z.number().int().min(0).optional().nullable(),
  minPlaySeconds: z.number().int().min(0).max(86400).default(0),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const GET = withAdminAuth(async (_req: NextRequest) => {
  try {
    const orm = await getDb();
    const bestScores = orm
      .select({
        gameId: gameBestScores.gameId,
        players: sql<number>`COUNT(*)::int`.as("players"),
        totalWins: sql<number>`SUM(${gameBestScores.wins})::int`.as("total_wins"),
      })
      .from(gameBestScores)
      .groupBy(gameBestScores.gameId)
      .as("bs");

    const challenges = orm
      .select({
        gameId: gameChallenges.gameId,
        challenges: sql<number>`COUNT(*)::int`.as("challenges"),
      })
      .from(gameChallenges)
      .groupBy(gameChallenges.gameId)
      .as("ch");

    const rows = await orm
      .select({
        id: games.id,
        slug: games.slug,
        name: games.name,
        category: games.category,
        engineKey: games.engineKey,
        coverEmoji: games.coverEmoji,
        coverImageUrl: games.coverImageUrl,
        tagline: games.tagline,
        isActive: games.isActive,
        isPublic: games.isPublic,
        sortOrder: games.sortOrder,
        rewardCreditsPerWin: games.rewardCreditsPerWin,
        rewardXpPerWin: games.rewardXpPerWin,
        rewardStarsPerWin: games.rewardStarsPerWin,
        playCostCredits: games.playCostCredits,
        playCostStars: games.playCostStars,
        maxScore: games.maxScore,
        minPlaySeconds: games.minPlaySeconds,
        playCount: games.playCount,
        createdAt: games.createdAt,
        players: sql<number>`COALESCE(${bestScores.players}, 0)`,
        totalWins: sql<number>`COALESCE(${bestScores.totalWins}, 0)`,
        challenges: sql<number>`COALESCE(${challenges.challenges}, 0)`,
      })
      .from(games)
      .leftJoin(bestScores, eq(bestScores.gameId, games.id))
      .leftJoin(challenges, eq(challenges.gameId, games.id))
      .where(isNull(games.deletedAt))
      .orderBy(
        sql`${games.category} NULLS LAST`,
        asc(games.sortOrder),
        asc(games.name)
      );

    // bigint columns (maxScore, playCount) don't serialize via JSON.stringify —
    // stringify them, matching the raw pg driver's original string return type.
    const gamesResult = rows.map((g) => ({
      ...g,
      maxScore: g.maxScore === null ? null : g.maxScore.toString(),
      playCount: g.playCount.toString(),
    }));

    return NextResponse.json({ success: true, data: { games: gamesResult }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    const body = await validateBody(req, createSchema);
    const orm = await getDb();

    const slug = body.slug
      ? body.slug
      : await generateUniqueSlug("game", body.name, crypto.randomUUID());

    // Reject a duplicate explicit slug.
    if (body.slug) {
      const [dup] = await orm
        .select({ id: games.id })
        .from(games)
        .where(and(eq(games.slug, slug), isNull(games.deletedAt)))
        .limit(1);
      if (dup) throw badRequest("A game with that slug already exists.");
    }

    const [created] = await orm
      .insert(games)
      .values({
        slug,
        name: body.name,
        category: body.category,
        engineKey: body.engineKey,
        tagline: body.tagline ?? null,
        description: body.description ?? null,
        longDescription: body.longDescription ?? null,
        coverEmoji: body.coverEmoji,
        coverImageUrl: body.coverImageUrl ?? null,
        rewardCreditsPerWin: body.rewardCreditsPerWin,
        rewardXpPerWin: body.rewardXpPerWin,
        rewardStarsPerWin: body.rewardStarsPerWin,
        playCostCredits: body.playCostCredits,
        playCostStars: body.playCostStars,
        maxScore: body.maxScore !== undefined && body.maxScore !== null ? BigInt(body.maxScore) : null,
        minPlaySeconds: body.minPlaySeconds,
        sortOrder: body.sortOrder,
        isActive: body.isActive,
        creatorId: auth.user.sub,
      })
      .returning({ id: games.id });

    return NextResponse.json({ success: true, data: { id: created.id, slug }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
