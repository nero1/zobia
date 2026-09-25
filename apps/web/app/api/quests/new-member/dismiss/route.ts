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
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

    const orm = await getDb();
    const rows = await orm
      .insert(schema.newMemberQuestDismissals)
      .values({
        userId: auth.user.sub,
        dismissCount: body.dismissCount,
        lastDismissedAt: sql`NOW()`,
        dontRemindAgain: body.dontRemindAgain,
      })
      .onConflictDoUpdate({
        target: schema.newMemberQuestDismissals.userId,
        set: {
          dismissCount: sql`GREATEST(${schema.newMemberQuestDismissals.dismissCount}, ${body.dismissCount})`,
          lastDismissedAt: sql`NOW()`,
          dontRemindAgain: sql`${schema.newMemberQuestDismissals.dontRemindAgain} OR ${body.dontRemindAgain}`,
          updatedAt: sql`NOW()`,
        },
      })
      .returning({
        dismiss_count: schema.newMemberQuestDismissals.dismissCount,
        dont_remind_again: schema.newMemberQuestDismissals.dontRemindAgain,
        last_dismissed_at: schema.newMemberQuestDismissals.lastDismissedAt,
      });

    return NextResponse.json({ success: true, data: rows[0], error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

/** GET — lets a fresh device/session pick up an existing "don't remind again" choice made elsewhere. */
export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const orm = await getDb();
    const rows = await orm
      .select({
        dismiss_count: schema.newMemberQuestDismissals.dismissCount,
        dont_remind_again: schema.newMemberQuestDismissals.dontRemindAgain,
        last_dismissed_at: schema.newMemberQuestDismissals.lastDismissedAt,
      })
      .from(schema.newMemberQuestDismissals)
      .where(eq(schema.newMemberQuestDismissals.userId, auth.user.sub))
      .limit(1);
    return NextResponse.json({
      success: true,
      data: rows[0] ?? { dismiss_count: 0, dont_remind_again: false, last_dismissed_at: null },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
