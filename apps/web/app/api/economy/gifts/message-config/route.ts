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
import { and, eq, isNull } from "drizzle-orm";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { getGiftMessageConfig } from "@/lib/plans/giftMessage";

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const orm = await getDb();
    const [userRows, bizRows] = await Promise.all([
      orm
        .select({ plan: schema.users.plan, rank_level: schema.users.rankLevel })
        .from(schema.users)
        .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
        .limit(1),
      orm
        .select({ tier: schema.businessAccounts.tier })
        .from(schema.businessAccounts)
        .where(eq(schema.businessAccounts.userId, userId))
        .limit(1),
    ]);

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
