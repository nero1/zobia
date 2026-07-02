export const dynamic = "force-dynamic";

/**
 * app/api/games/saves/route.ts
 *
 * Save Slots — pause an in-progress game and resume it later. Slot count is
 * plan-gated (lib/plans/saveSlots.ts).
 *
 * GET  /api/games/saves  – list the user's saves + their slot limit/usage
 * POST /api/games/saves  – create a new save { gameId, state, score, label? }
 *                          or overwrite one { saveId, state, score, label? }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { getGameById } from "@/lib/games/repo";
import { listSavesForUser, upsertSave, getSlotLimitInfo } from "@/lib/games/saves";
import { db } from "@/lib/db";

const saveSchema = z.object({
  gameId: z.string().uuid("gameId must be a valid UUID"),
  saveId: z.string().uuid().optional().nullable(),
  label: z.string().max(80).optional().nullable(),
  state: z.unknown(),
  score: z.number().int().min(0).max(1_000_000_000).default(0),
});

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    await assertGamesEnabled();

    const { rows: userRows } = await db.query<{ plan: string }>(
      `SELECT plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [auth.user.sub]
    );
    const plan = userRows[0]?.plan ?? "free";

    const [saves, slotInfo] = await Promise.all([
      listSavesForUser(auth.user.sub),
      getSlotLimitInfo(auth.user.sub, plan),
    ]);

    return NextResponse.json({
      success: true,
      data: { saves, limit: slotInfo.limit, count: slotInfo.count },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    await assertGamesEnabled();

    const body = await validateBody(req, saveSchema);
    const game = await getGameById(body.gameId);
    if (!game) throw notFound("Game not found.");

    const { rows: userRows } = await db.query<{ plan: string }>(
      `SELECT plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [auth.user.sub]
    );
    const plan = userRows[0]?.plan ?? "free";

    const save = await upsertSave({
      userId: auth.user.sub,
      plan,
      gameId: body.gameId,
      saveId: body.saveId ?? null,
      label: body.label ?? null,
      state: body.state,
      score: body.score,
    });

    return NextResponse.json({ success: true, data: { save }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
