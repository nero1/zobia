export const dynamic = 'force-dynamic';

/**
 * GET /api/economy/gifts/message-config
 *
 * Returns the current user's eligibility for the optional "Add a message"
 * box on the Send Gift flow: whether they can use it right now, the max
 * word count for their plan/tier, and (if ineligible because of level) the
 * minimum level required. Drives the collapsible message box in the Send
 * Gift UI — see lib/plans/giftMessage.ts for the underlying rules.
 *
 * @module app/api/economy/gifts/message-config
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { getGiftMessageConfig } from "@/lib/plans/giftMessage";

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const { rows: userRows } = await db.query<{ plan: string; rank_level: number }>(
      `SELECT COALESCE(plan, 'free') AS plan, COALESCE(rank_level, 1) AS rank_level
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    const { rows: bizRows } = await db.query<{ tier: string }>(
      `SELECT tier FROM business_accounts WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    const config = await getGiftMessageConfig(
      userRows[0]?.plan ?? "free",
      bizRows[0]?.tier ?? null,
      userRows[0]?.rank_level ?? 1
    );

    return NextResponse.json(config);
  } catch (err) {
    return handleApiError(err);
  }
});
