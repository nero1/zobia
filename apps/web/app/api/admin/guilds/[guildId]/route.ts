export const dynamic = 'force-dynamic';

/**
 * app/api/admin/guilds/[guildId]/route.ts
 *
 * Admin guild management — per-guild actions. Mirrors
 * app/api/admin/rooms/[roomId]/route.ts's mod-vs-admin action split.
 *
 * GET /api/admin/guilds/:guildId
 *   Full guild detail + member roster (bypasses the is_active filter that
 *   the member-facing GET /api/guilds/:guildId/members applies, so admins
 *   can still see/manage a suspended or banned guild's roster).
 *
 * PATCH /api/admin/guilds/:guildId
 *   Body: { action, ...actionFields }
 *   Actions:
 *     set_active / set_inactive   — toggle the plain "disable" flag
 *     suspend / unsuspend         — temporary, reason-tracked (admin or mod)
 *     ban                         — permanent (admin only)
 *     update_details              — edit name/crest/description/city/country/recruitment
 *     add_admin_notes             — internal notes (admin only)
 *     transfer_captain            — reassign captaincy to another member (admin only)
 *     remove_member               — kick any member, including the captain (admin or mod)
 *
 * DELETE /api/admin/guilds/:guildId
 *   Soft-delete (sets deleted_at). Admin only.
 *
 * Removing members here is a deliberate override of the PRD's normal rule
 * that "removal is always a Captain choice, never automatic" (PRD §13) —
 * admins/mods bypass creator-level rules the same way they already bypass
 * Guild-tier gates elsewhere (PRD §16).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, forbidden, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { writeAuditLog } from "@/lib/audit/auditLog";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_active") }),
  z.object({ action: z.literal("set_inactive") }),
  z.object({ action: z.literal("suspend"), reason: z.string().min(3).max(500) }),
  z.object({ action: z.literal("unsuspend") }),
  z.object({ action: z.literal("ban"), reason: z.string().min(3).max(500).optional() }),
  z.object({ action: z.literal("unban") }),
  z.object({
    action: z.literal("update_details"),
    name: z.string().min(3).max(40).optional(),
    crestEmoji: z.string().min(1).max(4).optional(),
    description: z.string().max(300).optional(),
    city: z.string().max(80).optional(),
    country: z.string().length(2).optional(),
    recruitmentType: z.enum(["open", "approval", "invite_only"]).optional(),
  }),
  z.object({ action: z.literal("add_admin_notes"), notes: z.string().max(2000) }),
  z.object({ action: z.literal("transfer_captain"), newCaptainUserId: z.string().uuid() }),
  z.object({ action: z.literal("remove_member"), userId: z.string().uuid() }),
]);

interface GuildCtx {
  params: Promise<{ guildId: string }>;
  auth: { user: { sub: string } };
}

async function requireAdminOrMod(userId: string) {
  const orm = await getDb();
  const [row] = await orm
    .select({ isAdmin: schema.users.isAdmin, isModerator: schema.users.isModerator })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), sql`${schema.users.deletedAt} IS NULL`))
    .limit(1);
  if (!row) throw forbidden("User not found");
  const isModerator = row.isModerator ?? false;
  if (!row.isAdmin && !isModerator) throw forbidden("Admin or moderator access required");
  return { is_admin: row.isAdmin, is_moderator: isModerator };
}

// ---------------------------------------------------------------------------
// GET /api/admin/guilds/:guildId
// ---------------------------------------------------------------------------

export const GET = withAuth(async (req: NextRequest, { params, auth }: GuildCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { guildId } = await params;
    if (!UUID_RE.test(guildId)) throw badRequest("guildId must be a valid UUID");
    await requireAdminOrMod(auth.user.sub);

    const orm = await getDb();

    const [guildRow] = await orm
      .select({ guild: schema.guilds, captainUsername: schema.users.username })
      .from(schema.guilds)
      .innerJoin(schema.users, eq(schema.users.id, schema.guilds.captainId))
      .where(and(eq(schema.guilds.id, guildId), sql`${schema.guilds.deletedAt} IS NULL`))
      .limit(1);
    if (!guildRow) throw notFound("Guild not found");

    const memberRows = await orm
      .select({
        id: schema.guildMembers.id,
        user_id: schema.guildMembers.userId,
        role: schema.guildMembers.role,
        contribution_score: schema.guildMembers.contributionScore,
        war_points_total: schema.guildMembers.warPointsTotal,
        joined_at: schema.guildMembers.joinedAt,
        username: schema.users.username,
        display_name: schema.users.displayName,
        avatar_emoji: schema.users.avatarEmoji,
      })
      .from(schema.guildMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.guildMembers.userId))
      .where(eq(schema.guildMembers.guildId, guildId))
      .orderBy(sql`${schema.guildMembers.role} = 'captain' DESC`, desc(schema.guildMembers.contributionScore));

    // bigint columns don't serialize via JSON.stringify — stringify them.
    const guild = {
      ...guildRow.guild,
      guildXp: guildRow.guild.guildXp.toString(),
      treasuryBalance: guildRow.guild.treasuryBalance.toString(),
      treasuryCap: guildRow.guild.treasuryCap.toString(),
      captain_username: guildRow.captainUsername,
    };

    return NextResponse.json({ success: true, data: { guild, members: memberRows } });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/guilds/:guildId
// ---------------------------------------------------------------------------

export const PATCH = withAuth(async (req: NextRequest, { params, auth }: GuildCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { guildId } = await params;
    if (!UUID_RE.test(guildId)) throw badRequest("guildId must be a valid UUID");

    const roles = await requireAdminOrMod(auth.user.sub);
    const body = await validateBody(req, patchSchema);

    // Destructive/identity-changing actions require full admin.
    const adminOnlyActions = ["ban", "unban", "add_admin_notes", "transfer_captain"];
    if (adminOnlyActions.includes(body.action) && !roles.is_admin) {
      throw forbidden("Administrator access required for this action");
    }

    const orm = await getDb();
    const [guild] = await orm
      .select({ id: schema.guilds.id, name: schema.guilds.name, captain_id: schema.guilds.captainId })
      .from(schema.guilds)
      .where(and(eq(schema.guilds.id, guildId), sql`${schema.guilds.deletedAt} IS NULL`))
      .limit(1);
    if (!guild) throw notFound("Guild not found");

    if (body.action === "transfer_captain" || body.action === "remove_member") {
      // Handled in their own transaction blocks below (multi-table writes).
    } else {
      const updates: Partial<typeof schema.guilds.$inferInsert> = { updatedAt: new Date() };

      switch (body.action) {
        case "set_active":
          updates.isActive = true;
          break;
        case "set_inactive":
          updates.isActive = false;
          break;
        case "suspend":
          updates.isSuspended = true;
          updates.suspendedAt = new Date();
          updates.suspendedBy = auth.user.sub;
          updates.suspensionReason = body.reason;
          updates.isActive = false;
          break;
        case "unsuspend":
          updates.isSuspended = false;
          updates.suspendedAt = null;
          updates.suspendedBy = null;
          updates.suspensionReason = null;
          updates.isActive = true;
          break;
        case "ban":
          updates.isBanned = true;
          updates.bannedAt = new Date();
          updates.bannedBy = auth.user.sub;
          updates.isActive = false;
          updates.isSuspended = false;
          break;
        case "unban":
          updates.isBanned = false;
          updates.bannedAt = null;
          updates.bannedBy = null;
          break;
        case "update_details": {
          if (body.name !== undefined) updates.name = body.name;
          if (body.crestEmoji !== undefined) updates.crestEmoji = body.crestEmoji;
          if (body.description !== undefined) updates.description = body.description;
          if (body.city !== undefined) updates.city = body.city;
          if (body.country !== undefined) updates.country = body.country;
          if (body.recruitmentType !== undefined) updates.recruitmentType = body.recruitmentType;
          break;
        }
        case "add_admin_notes":
          updates.adminNotes = body.notes;
          break;
      }

      await orm.update(schema.guilds).set(updates).where(eq(schema.guilds.id, guildId));

      writeAuditLog({
        actorId: auth.user.sub,
        action:
          body.action === "suspend" ? "admin_suspend_guild"
          : body.action === "unsuspend" ? "admin_unsuspend_guild"
          : body.action === "ban" ? "admin_ban_guild"
          : body.action === "set_inactive" ? "admin_disable_guild"
          : body.action === "set_active" ? "admin_enable_guild"
          : "admin_disable_guild",
        targetType: "guild",
        targetId: guildId,
        metadata: { action: body.action, guildName: guild.name },
      });

      return NextResponse.json({ success: true, data: { guildId, action: body.action } });
    }

    if (body.action === "transfer_captain") {
      if (body.newCaptainUserId === guild.captain_id) {
        throw badRequest("User is already the guild captain");
      }
      await orm.transaction(async (tx) => {
        const [memberCheck] = await tx
          .select({ role: schema.guildMembers.role })
          .from(schema.guildMembers)
          .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, body.newCaptainUserId)))
          .limit(1);
        if (!memberCheck) throw badRequest("Target user is not a member of this guild");

        await tx
          .update(schema.guildMembers)
          .set({ role: "veteran" })
          .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, guild.captain_id)));
        await tx
          .update(schema.guildMembers)
          .set({ role: "captain" })
          .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, body.newCaptainUserId)));
        await tx
          .update(schema.guilds)
          .set({ captainId: body.newCaptainUserId, updatedAt: new Date() })
          .where(eq(schema.guilds.id, guildId));
      });

      writeAuditLog({
        actorId: auth.user.sub,
        action: "admin_transfer_guild_captain",
        targetType: "guild",
        targetId: guildId,
        metadata: { guildName: guild.name, previousCaptainId: guild.captain_id, newCaptainId: body.newCaptainUserId },
      });

      return NextResponse.json({ success: true, data: { guildId, action: body.action } });
    }

    if (body.action === "remove_member") {
      await orm.transaction(async (tx) => {
        if (body.userId === guild.captain_id) {
          throw badRequest("Cannot remove the captain; transfer captaincy first");
        }
        const removed = await tx
          .delete(schema.guildMembers)
          .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, body.userId)))
          .returning({ id: schema.guildMembers.id });
        if (removed.length === 0) throw notFound("Member not found in this guild");

        await tx
          .update(schema.guilds)
          .set({ memberCount: sql`GREATEST(${schema.guilds.memberCount} - 1, 0)`, updatedAt: new Date() })
          .where(eq(schema.guilds.id, guildId));
        await tx
          .update(schema.users)
          .set({ guildId: null, updatedAt: new Date() })
          .where(eq(schema.users.id, body.userId));
      });

      writeAuditLog({
        actorId: auth.user.sub,
        action: "admin_remove_guild_member",
        targetType: "guild",
        targetId: guildId,
        metadata: { guildName: guild.name, removedUserId: body.userId },
      });

      return NextResponse.json({ success: true, data: { guildId, action: body.action } });
    }

    throw badRequest("Unsupported action");
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/guilds/:guildId
// ---------------------------------------------------------------------------

export const DELETE = withAuth(async (req: NextRequest, { params, auth }: GuildCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { guildId } = await params;
    if (!UUID_RE.test(guildId)) throw badRequest("guildId must be a valid UUID");

    const orm = await getDb();

    const [userRow] = await orm
      .select({ isAdmin: schema.users.isAdmin })
      .from(schema.users)
      .where(and(eq(schema.users.id, auth.user.sub), sql`${schema.users.deletedAt} IS NULL`))
      .limit(1);
    if (!userRow?.isAdmin) throw forbidden("Administrator access required");

    const [guildRow] = await orm
      .select({ id: schema.guilds.id, name: schema.guilds.name })
      .from(schema.guilds)
      .where(and(eq(schema.guilds.id, guildId), sql`${schema.guilds.deletedAt} IS NULL`))
      .limit(1);
    if (!guildRow) throw notFound("Guild not found");

    await orm.transaction(async (tx) => {
      await tx
        .update(schema.guilds)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(eq(schema.guilds.id, guildId));
      await tx
        .update(schema.users)
        .set({ guildId: null, updatedAt: new Date() })
        .where(eq(schema.users.guildId, guildId));
    });

    writeAuditLog({
      actorId: auth.user.sub,
      action: "admin_delete_guild",
      targetType: "guild",
      targetId: guildId,
      metadata: { guildName: guildRow.name },
    });

    return NextResponse.json({ success: true, data: { guildId, deleted: true } });
  } catch (err) {
    return handleApiError(err);
  }
});
