export const dynamic = 'force-dynamic';

/**
 * app/api/quests/new-member/dismiss/route.ts
 *
 * POST /api/quests/new-member/dismiss
 *
 * Durable server-side fallback for the New Member Quest "don't remind again"
 * nudge. The CLIENT owns the fast path via localStorage (scoped per-user-id
 * to avoid leaking between users of a shared device) — this route should
 * only be called occasionally (after 4 local dismissals, or immediately on
 * an explicit "don't remind again" click), not on every dismiss, to keep
 * DB load low. Upserts new_member_quest_dismissals for the session user.
 *
 * Body: { dismissCount: number, dontRemindAgain: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

const dismissSchema = z.object({
  dismissCount: z.number().int().min(0).max(1000),
  dontRemindAgain: z.boolean(),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const body = await validateBody(req, dismissSchema);

    const { rows } = await db.query(
      `INSERT INTO new_member_quest_dismissals (user_id, dismiss_count, last_dismissed_at, dont_remind_again)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (user_id) DO UPDATE
         SET dismiss_count = GREATEST(new_member_quest_dismissals.dismiss_count, EXCLUDED.dismiss_count),
             last_dismissed_at = NOW(),
             dont_remind_again = new_member_quest_dismissals.dont_remind_again OR EXCLUDED.dont_remind_again,
             updated_at = NOW()
       RETURNING dismiss_count, dont_remind_again, last_dismissed_at`,
      [auth.user.sub, body.dismissCount, body.dontRemindAgain]
    );

    return NextResponse.json({ success: true, data: rows[0], error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

/** GET — lets a fresh device/session pick up an existing "don't remind again" choice made elsewhere. */
export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const { rows } = await db.query(
      `SELECT dismiss_count, dont_remind_again, last_dismissed_at FROM new_member_quest_dismissals WHERE user_id = $1 LIMIT 1`,
      [auth.user.sub]
    );
    return NextResponse.json({
      success: true,
      data: rows[0] ?? { dismiss_count: 0, dont_remind_again: false, last_dismissed_at: null },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
