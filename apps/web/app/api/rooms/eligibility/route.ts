export const dynamic = 'force-dynamic';

/**
 * app/api/rooms/eligibility/route.ts
 *
 * GET /api/rooms/eligibility
 *   Tells the room-creation UI which room types the caller may create, so it
 *   can hide (not just disable) buttons for types the user isn't eligible
 *   for instead of letting them submit and hit a 403 (BUG-ROOMS-03).
 *   Admins are eligible for every type — mirrors the bypasses in
 *   POST /api/rooms and GET /api/rooms/[roomId].
 *
 * Kept in sync with the eligibility checks in POST /api/rooms:
 *   - free_open / drop / tipping: any creator-eligible account.
 *   - vip: creator-eligible account (price range enforced at submit time).
 *   - classroom: creator-eligible account (paid enrolment additionally needs
 *     the Trust Score gate — reported as a reason, not a hard block, since
 *     free classrooms are still allowed).
 *   - guild: caller must own/administer a Platinum-tier+ guild (or be admin).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, forbidden } from "@/lib/api/errors";

const CREATOR_TIERS_ALLOWED = ["rising", "verified", "elite", "icon"] as const;

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const db = await getDb();
    const userRows = await db
      .select({
        creatorRole: schema.users.creatorRole,
        creatorTier: schema.users.creatorTier,
        isAdmin: schema.users.isAdmin,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, auth.user.sub), isNull(schema.users.deletedAt)));
    const user = userRows[0];
    if (!user) throw forbidden("User not found");

    const isAdmin = user.isAdmin;
    const isCreatorEligible =
      isAdmin ||
      user.creatorRole ||
      (user.creatorTier !== null &&
        CREATOR_TIERS_ALLOWED.includes(user.creatorTier as (typeof CREATOR_TIERS_ALLOWED)[number]));

    let hasEligibleGuild = false;
    let guilds: Array<{ id: string; name: string; tier: string }> = [];
    if (isAdmin) {
      // Admins can attach a Guild Room to any guild — offer the full list.
      const rows = await db
        .select({ id: schema.guilds.id, name: schema.guilds.name, tier: schema.guilds.tier })
        .from(schema.guilds)
        .orderBy(asc(schema.guilds.name))
        .limit(200);
      guilds = rows;
      hasEligibleGuild = rows.length > 0;
    } else {
      const platinumAndAbove = ["platinum_1", "platinum_2", "platinum_3", "legend"];
      const rows = await db
        .select({ id: schema.guilds.id, name: schema.guilds.name, tier: schema.guilds.tier })
        .from(schema.guilds)
        .innerJoin(schema.guildMembers, eq(schema.guildMembers.guildId, schema.guilds.id))
        .where(
          and(
            eq(schema.guildMembers.userId, auth.user.sub),
            inArray(schema.guildMembers.role, ["owner", "admin"])
          )
        )
        .orderBy(asc(schema.guilds.name));
      guilds = rows.filter((g) => platinumAndAbove.includes(g.tier));
      hasEligibleGuild = guilds.length > 0;
    }

    const allowedTypes = isCreatorEligible
      ? ["free_open", "vip", "drop", "tipping", "classroom", ...(hasEligibleGuild ? ["guild"] : [])]
      : [];

    return NextResponse.json({
      success: true,
      data: {
        isAdmin,
        isCreatorEligible,
        allowedTypes,
        eligibleGuilds: guilds,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
