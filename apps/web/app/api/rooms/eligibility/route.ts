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
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, forbidden } from "@/lib/api/errors";

const CREATOR_TIERS_ALLOWED = ["rising", "verified", "elite", "icon"] as const;

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const { rows: userRows } = await db.query<{
      creator_role: boolean;
      creator_tier: string | null;
      is_admin: boolean;
    }>(
      `SELECT creator_role, creator_tier, is_admin
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [auth.user.sub]
    );
    const user = userRows[0];
    if (!user) throw forbidden("User not found");

    const isAdmin = user.is_admin;
    const isCreatorEligible =
      isAdmin ||
      user.creator_role ||
      (user.creator_tier !== null &&
        CREATOR_TIERS_ALLOWED.includes(user.creator_tier as (typeof CREATOR_TIERS_ALLOWED)[number]));

    let hasEligibleGuild = false;
    let guilds: Array<{ id: string; name: string; tier: string }> = [];
    if (isAdmin) {
      // Admins can attach a Guild Room to any guild — offer the full list.
      const { rows } = await db.query<{ id: string; name: string; tier: string }>(
        `SELECT id, name, tier FROM guilds ORDER BY name ASC LIMIT 200`
      );
      guilds = rows;
      hasEligibleGuild = rows.length > 0;
    } else {
      const platinumAndAbove = ["platinum_1", "platinum_2", "platinum_3", "legend"];
      const { rows } = await db.query<{ id: string; name: string; tier: string }>(
        `SELECT g.id, g.name, g.tier FROM guilds g
         JOIN guild_members gm ON gm.guild_id = g.id
         WHERE gm.user_id = $1 AND gm.role IN ('owner', 'admin')
         ORDER BY g.name ASC`,
        [auth.user.sub]
      );
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
