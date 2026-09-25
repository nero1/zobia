export const dynamic = 'force-dynamic';

/**
 * app/api/guilds/discovery/route.ts
 *
 * Guild Discovery Panel API.
 *
 * GET /api/guilds/discovery
 *   - Returns up to 3 recommended guilds based on the authenticated user's city
 *   - Filters to guilds that are open or approval-required (not invite-only)
 *   - Excludes guilds the user is already a member of
 *   - Orders by: same city first, then member_count DESC, then guild_xp DESC
 *   - Returns: id, name, crest_emoji, description, city, member_count,
 *              guild_xp, tier, war_wins, is_recruiting
 *
 * This endpoint is consumed by:
 *  - The Expo home tab "Crews near you are recruiting" panel (shown after 24h)
 *  - The Guild Discovery Panel triggered by the guild_discovery CRON notification
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /api/guilds/discovery
// ---------------------------------------------------------------------------

/**
 * Recommend up to 3 guilds for the authenticated user.
 *
 * Priority:
 *  1. Guilds in the same city as the user
 *  2. Larger guilds (member_count DESC)
 *  3. More experienced guilds (guild_xp DESC)
 *
 * Only open or approval-required guilds are returned (not invite_only).
 * Guilds the user already belongs to are excluded.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;

    // PRD §4 Step 5: Guild Discovery is shown only after the user's first 24 hours
    const orm = await getDb();
    const [user] = await orm
      .select({
        city: schema.users.city,
        guildId: schema.users.guildId,
        createdAt: schema.users.createdAt,
        guildEmphasis: sql<string | null>`${schema.users.onboardingPersonalization}->>'guild_emphasis'`,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    const accountAgeHours = user?.createdAt ? (Date.now() - user.createdAt.getTime()) / 3_600_000 : 999;

    if (accountAgeHours < 24) {
      return NextResponse.json({
        success: true,
        data: { guilds: [], userCity: user?.city ?? null, tooNew: true },
        error: null,
      }, { status: 200 });
    }

    const userCity = user?.city ?? null;
    const guildEmphasis = (user?.guildEmphasis as 'guild' | 'solo' | null) ?? null;
    const soloNote =
      guildEmphasis === 'solo'
        ? "You can explore Zobia solo — but crew members earn up to 50% more XP on the same actions."
        : null;

    // 1. Find guilds the user is already a member of (covers multi-guild edge case)
    const membershipRows = await orm
      .select({ guildId: schema.guildMembers.guildId })
      .from(schema.guildMembers)
      .where(eq(schema.guildMembers.userId, userId));
    const memberGuildIds = membershipRows.map((r) => r.guildId);

    // Always exclude the user's primary guild_id if set
    if (user?.guildId && !memberGuildIds.includes(user.guildId)) {
      memberGuildIds.push(user.guildId);
    }

    // 2. Query recommended guilds
    //    Excludes invite_only and guilds the user is already in.
    //    Orders: same city first, then member_count DESC, then guild_xp DESC.
    const sameCityExpr = sql<boolean>`(${userCity !== null} AND ${schema.guilds.city} ILIKE ${userCity})`;
    const guilds = await orm
      .select({
        id: schema.guilds.id,
        name: schema.guilds.name,
        crestEmoji: schema.guilds.crestEmoji,
        description: schema.guilds.description,
        city: schema.guilds.city,
        memberCount: schema.guilds.memberCount,
        guildXp: schema.guilds.guildXp,
        tier: schema.guilds.tier,
        warsWon: schema.guilds.warsWon,
        isRecruiting: sql<boolean>`(${schema.guilds.recruitmentType} != 'invite_only')`,
        sameCity: sameCityExpr,
      })
      .from(schema.guilds)
      .where(
        and(
          eq(schema.guilds.isActive, true),
          inArray(schema.guilds.recruitmentType, ["open", "approval"]),
          memberGuildIds.length > 0 ? notInArray(schema.guilds.id, memberGuildIds) : undefined
        )
      )
      .orderBy(desc(sameCityExpr), desc(schema.guilds.memberCount), desc(schema.guilds.guildXp))
      .limit(3);

    return NextResponse.json(
      {
        success: true,
        data: {
          guilds: guilds.map((g) => ({
            id: g.id,
            name: g.name,
            crestEmoji: g.crestEmoji,
            description: g.description,
            city: g.city,
            memberCount: g.memberCount,
            guildXp: g.guildXp,
            tier: g.tier,
            warWins: g.warsWon,
            isRecruiting: g.isRecruiting,
            sameCity: g.sameCity,
          })),
          userCity,
          guildEmphasis,
          soloNote,
        },
        error: null,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
