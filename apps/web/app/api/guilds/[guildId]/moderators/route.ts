export const dynamic = 'force-dynamic';

/**
 * app/api/guilds/[guildId]/moderators/route.ts
 *
 * Forum Mods (PRD "Platform Mods and Forum Mods") — guild-scoped moderators
 * assigned by the guild's captain (or a platform admin). No sitewide
 * jurisdiction; capabilities are admin-configured at
 * /gate44/moderation/settings (moderation.guildModActions).
 *
 * GET    /api/guilds/[guildId]/moderators — list current Forum Mods (any guild member)
 * POST   /api/guilds/[guildId]/moderators — grant Forum Mod (captain or admin only)
 * DELETE /api/guilds/[guildId]/moderators — revoke Forum Mod (captain or admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { getStaffRoles } from "@/lib/auth/roles";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

const grantSchema = z.object({ userId: z.string().uuid() });

async function requireCaptainOrAdmin(guildId: string, userId: string): Promise<void> {
  const orm = await getDb();
  const [[guild], roles] = await Promise.all([
    orm
      .select({ captain_id: schema.guilds.captainId })
      .from(schema.guilds)
      .where(and(eq(schema.guilds.id, guildId), eq(schema.guilds.isActive, true)))
      .limit(1),
    getStaffRoles(userId),
  ]);
  if (!guild) throw notFound("Guild not found");
  if (guild.captain_id !== userId && !roles.isAdmin) {
    throw forbidden("Only the guild captain (or an admin) can manage Forum Mods.", "CAPTAIN_OR_ADMIN_ONLY");
  }
}

// ---------------------------------------------------------------------------
// GET — list Forum Mods
// ---------------------------------------------------------------------------

export const GET = withAuth<{ guildId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    const { guildId } = await params;
    const orm = await getDb();

    const membership = await orm
      .select({ id: schema.guildMembers.id })
      .from(schema.guildMembers)
      .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, auth.user.sub), isNull(schema.guildMembers.leftAt)))
      .limit(1);
    const roles = await getStaffRoles(auth.user.sub);
    if (membership.length === 0 && !roles.isAdmin) {
      throw forbidden("You must be a member of this guild.", "NOT_A_MEMBER");
    }

    const granter = alias(schema.users, "granter");
    const rows = await orm
      .select({
        user_id: schema.guildMembers.userId,
        username: schema.users.username,
        display_name: schema.users.displayName,
        avatar_emoji: schema.users.avatarEmoji,
        moderator_granted_at: schema.guildMembers.moderatorGrantedAt,
        granted_by_username: granter.username,
      })
      .from(schema.guildMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.guildMembers.userId))
      .leftJoin(granter, eq(granter.id, schema.guildMembers.moderatorGrantedBy))
      .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.isModerator, true), isNull(schema.guildMembers.leftAt)))
      .orderBy(sql`${schema.guildMembers.moderatorGrantedAt} ASC NULLS LAST`);

    return NextResponse.json({
      success: true,
      data: {
        items: rows.map((r) => ({
          userId: r.user_id,
          username: r.username,
          displayName: r.display_name,
          avatarEmoji: r.avatar_emoji,
          grantedAt: r.moderator_granted_at,
          grantedByUsername: r.granted_by_username,
        })),
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST — grant Forum Mod
// ---------------------------------------------------------------------------

export const POST = withAuth<{ guildId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { guildId } = await params;
    await requireCaptainOrAdmin(guildId, auth.user.sub);
    const { userId } = await validateBody(req, grantSchema);
    const orm = await getDb();

    const updated = await orm
      .update(schema.guildMembers)
      .set({ isModerator: true, moderatorGrantedBy: auth.user.sub, moderatorGrantedAt: new Date() })
      .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, userId), isNull(schema.guildMembers.leftAt)))
      .returning({ id: schema.guildMembers.id });
    if (updated.length === 0) throw badRequest("That user is not a member of this guild.", "NOT_A_MEMBER");

    return NextResponse.json({ success: true, data: { userId, isModerator: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE — revoke Forum Mod
// ---------------------------------------------------------------------------

export const DELETE = withAuth<{ guildId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { guildId } = await params;
    await requireCaptainOrAdmin(guildId, auth.user.sub);
    const { userId } = await validateBody(req, grantSchema);
    const orm = await getDb();

    await orm
      .update(schema.guildMembers)
      .set({ isModerator: false, moderatorGrantedBy: null, moderatorGrantedAt: null })
      .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, userId)));

    return NextResponse.json({ success: true, data: { userId, isModerator: false }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
