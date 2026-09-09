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
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { getStaffRoles } from "@/lib/auth/roles";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

const grantSchema = z.object({ userId: z.string().uuid() });

async function requireCaptainOrAdmin(guildId: string, userId: string): Promise<void> {
  const [{ rows: guildRows }, roles] = await Promise.all([
    db.query<{ captain_id: string }>(`SELECT captain_id FROM guilds WHERE id = $1 AND is_active = TRUE`, [guildId]),
    getStaffRoles(userId),
  ]);
  const guild = guildRows[0];
  if (!guild) throw notFound("Guild not found");
  if (guild.captain_id !== userId && !roles.isAdmin) {
    throw forbidden("Only the guild captain (or an admin) can manage Forum Mods.", "CAPTAIN_OR_ADMIN_ONLY");
  }
}

interface ModeratorRow {
  user_id: string;
  username: string;
  display_name: string;
  avatar_emoji: string;
  moderator_granted_at: string | null;
  granted_by_username: string | null;
}

// ---------------------------------------------------------------------------
// GET — list Forum Mods
// ---------------------------------------------------------------------------

export const GET = withAuth<{ guildId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    const { guildId } = await params;

    const membership = await db.query<{ id: string }>(
      `SELECT id FROM guild_members WHERE guild_id = $1 AND user_id = $2 AND left_at IS NULL LIMIT 1`,
      [guildId, auth.user.sub]
    );
    const roles = await getStaffRoles(auth.user.sub);
    if (membership.rows.length === 0 && !roles.isAdmin) {
      throw forbidden("You must be a member of this guild.", "NOT_A_MEMBER");
    }

    const { rows } = await db.query<ModeratorRow>(
      `SELECT gm.user_id, u.username, u.display_name, u.avatar_emoji,
              gm.moderator_granted_at, granter.username AS granted_by_username
       FROM guild_members gm
       JOIN users u ON u.id = gm.user_id
       LEFT JOIN users granter ON granter.id = gm.moderator_granted_by
       WHERE gm.guild_id = $1 AND gm.is_moderator = true AND gm.left_at IS NULL
       ORDER BY gm.moderator_granted_at ASC NULLS LAST`,
      [guildId]
    );

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

    const { rows } = await db.query<{ id: string }>(
      `UPDATE guild_members
       SET is_moderator = true, moderator_granted_by = $3, moderator_granted_at = NOW()
       WHERE guild_id = $1 AND user_id = $2 AND left_at IS NULL
       RETURNING id`,
      [guildId, userId, auth.user.sub]
    );
    if (rows.length === 0) throw badRequest("That user is not a member of this guild.", "NOT_A_MEMBER");

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

    await db.query(
      `UPDATE guild_members
       SET is_moderator = false, moderator_granted_by = NULL, moderator_granted_at = NULL
       WHERE guild_id = $1 AND user_id = $2`,
      [guildId, userId]
    );

    return NextResponse.json({ success: true, data: { userId, isModerator: false }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
