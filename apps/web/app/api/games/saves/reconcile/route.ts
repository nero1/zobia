export const dynamic = "force-dynamic";

/**
 * app/api/games/saves/reconcile/route.ts
 *
 * POST /api/games/saves/reconcile
 *
 * After a plan downgrade drops the user's save-slot limit below their
 * current save count, this trims them back down to the limit:
 *   - { deleteIds: [...] } — deletes exactly those saves (the "let me pick"
 *     flow: the client shows the user's saves with checkboxes).
 *   - {} (no deleteIds) — deletes the oldest-updated saves beyond the
 *     current plan limit (the "just delete the oldest" confirm flow).
 * Both paths require an explicit POST (i.e. the user has already confirmed
 * "Proceed?" client-side) — this endpoint never runs silently.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { getSlotLimitInfo, reconcileSavesForUser } from "@/lib/games/saves";
import { db } from "@/lib/db";

const reconcileSchema = z.object({
  deleteIds: z.array(z.string().uuid()).max(50).optional(),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    await assertGamesEnabled();

    const body = await validateBody(req, reconcileSchema);

    const { rows: userRows } = await db.query<{ plan: string }>(
      `SELECT plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [auth.user.sub]
    );
    const plan = userRows[0]?.plan ?? "free";
    const { limit, count } = await getSlotLimitInfo(auth.user.sub, plan);

    if (count <= limit && (!body.deleteIds || body.deleteIds.length === 0)) {
      return NextResponse.json({ success: true, data: { deletedIds: [] }, error: null });
    }

    if (body.deleteIds && count - body.deleteIds.length > limit) {
      throw badRequest(
        `You need to delete at least ${count - limit} save(s) to fit your plan's ${limit}-slot limit.`
      );
    }

    const deletedIds = await reconcileSavesForUser(auth.user.sub, limit, body.deleteIds);
    return NextResponse.json({ success: true, data: { deletedIds }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
