export const dynamic = "force-dynamic";

/**
 * app/api/games/challenges
 *
 * GET  — list the authenticated user's challenges (sent + received).
 * POST — create a challenge against another user by username.
 *        Body: { gameSlug, opponentUsername, rounds (1|3), wagerCredits }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { getActiveGameBySlug } from "@/lib/games/repo";
import { createChallenge, listUserChallenges } from "@/lib/games/challenges";

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    await assertGamesEnabled();
    const challenges = await listUserChallenges(auth.user.sub);
    return NextResponse.json({ success: true, data: { challenges }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

const createSchema = z.object({
  gameSlug: z.string().min(1),
  opponentUsername: z.string().min(1),
  rounds: z.union([z.literal(1), z.literal(3)]),
  wagerCredits: z.number().int().nonnegative().max(1_000_000).default(0),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    await assertGamesEnabled();

    const body = await validateBody(req, createSchema);
    const game = await getActiveGameBySlug(body.gameSlug);
    if (!game) throw notFound("Game not found.");

    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
      [body.opponentUsername]
    );
    if (!rows[0]) throw notFound("Opponent not found.");

    const created = await createChallenge({
      challengerId: auth.user.sub,
      opponentId: rows[0].id,
      gameId: game.id,
      rounds: body.rounds,
      wagerCredits: body.wagerCredits,
    });

    return NextResponse.json({ success: true, data: created, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
