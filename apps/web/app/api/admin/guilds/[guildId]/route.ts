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
import { db, SqlParam } from "@/lib/db";
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
  const { rows } = await db.query<{ is_admin: boolean; is_moderator: boolean }>(
    `SELECT is_admin, COALESCE(is_moderator, FALSE) AS is_moderator
     FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  if (!rows[0]) throw forbidden("User not found");
  if (!rows[0].is_admin && !rows[0].is_moderator) throw forbidden("Admin or moderator access required");
  return rows[0];
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

    const { rows: guildRows } = await db.query(
      `SELECT g.*, u.username AS captain_username
       FROM guilds g JOIN users u ON u.id = g.captain_id
       WHERE g.id = $1 AND g.deleted_at IS NULL LIMIT 1`,
      [guildId]
    );
    if (!guildRows[0]) throw notFound("Guild not found");

    const { rows: members } = await db.query(
      `SELECT gm.id, gm.user_id, gm.role, gm.contribution_score, gm.war_points_total, gm.joined_at,
              u.username, u.display_name, u.avatar_emoji
       FROM guild_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.guild_id = $1
       ORDER BY gm.role = 'captain' DESC, gm.contribution_score DESC`,
      [guildId]
    );

    return NextResponse.json({ success: true, data: { guild: guildRows[0], members } });
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

    const { rows: guildRows } = await db.query<{ id: string; name: string; captain_id: string }>(
      `SELECT id, name, captain_id FROM guilds WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [guildId]
    );
    if (!guildRows[0]) throw notFound("Guild not found");
    const guild = guildRows[0];

    if (body.action === "transfer_captain" || body.action === "remove_member") {
      // Handled in their own transaction blocks below (multi-table writes).
    } else {
      let updateSql = "";
      const updateValues: SqlParam[] = [];

      switch (body.action) {
        case "set_active":
          updateSql = `is_active = TRUE, updated_at = NOW()`;
          break;
        case "set_inactive":
          updateSql = `is_active = FALSE, updated_at = NOW()`;
          break;
        case "suspend":
          updateSql = `is_suspended = TRUE, suspended_at = NOW(), suspended_by = $2, suspension_reason = $3, is_active = FALSE, updated_at = NOW()`;
          updateValues.push(auth.user.sub, body.reason);
          break;
        case "unsuspend":
          updateSql = `is_suspended = FALSE, suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL, is_active = TRUE, updated_at = NOW()`;
          break;
        case "ban":
          updateSql = `is_banned = TRUE, banned_at = NOW(), banned_by = $2, is_active = FALSE, is_suspended = FALSE, updated_at = NOW()`;
          updateValues.push(auth.user.sub);
          break;
        case "unban":
          updateSql = `is_banned = FALSE, banned_at = NULL, banned_by = NULL, updated_at = NOW()`;
          break;
        case "update_details": {
          const setParts: string[] = ["updated_at = NOW()"];
          let idx = 2;
          if (body.name !== undefined) { setParts.push(`name = $${idx++}`); updateValues.push(body.name); }
          if (body.crestEmoji !== undefined) { setParts.push(`crest_emoji = $${idx++}`); updateValues.push(body.crestEmoji); }
          if (body.description !== undefined) { setParts.push(`description = $${idx++}`); updateValues.push(body.description); }
          if (body.city !== undefined) { setParts.push(`city = $${idx++}`); updateValues.push(body.city); }
          if (body.country !== undefined) { setParts.push(`country = $${idx++}`); updateValues.push(body.country); }
          if (body.recruitmentType !== undefined) { setParts.push(`recruitment_type = $${idx++}`); updateValues.push(body.recruitmentType); }
          updateSql = setParts.join(", ");
          break;
        }
        case "add_admin_notes":
          updateSql = `admin_notes = $2, updated_at = NOW()`;
          updateValues.push(body.notes);
          break;
      }

      const allValues = [guildId, ...updateValues];
      await db.query(`UPDATE guilds SET ${updateSql} WHERE id = $1`, allValues);

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
      await db.transaction(async (client) => {
        const memberCheck = await client.query<{ role: string }>(
          `SELECT role FROM guild_members WHERE guild_id = $1 AND user_id = $2 LIMIT 1`,
          [guildId, body.newCaptainUserId]
        );
        if (!memberCheck.rows[0]) throw badRequest("Target user is not a member of this guild");

        await client.query(
          `UPDATE guild_members SET role = 'veteran' WHERE guild_id = $1 AND user_id = $2`,
          [guildId, guild.captain_id]
        );
        await client.query(
          `UPDATE guild_members SET role = 'captain' WHERE guild_id = $1 AND user_id = $2`,
          [guildId, body.newCaptainUserId]
        );
        await client.query(
          `UPDATE guilds SET captain_id = $2, updated_at = NOW() WHERE id = $1`,
          [guildId, body.newCaptainUserId]
        );
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
      await db.transaction(async (client) => {
        if (body.userId === guild.captain_id) {
          throw badRequest("Cannot remove the captain; transfer captaincy first");
        }
        const removeResult = await client.query(
          `DELETE FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
          [guildId, body.userId]
        );
        if (removeResult.rowCount === 0) throw notFound("Member not found in this guild");

        await client.query(
          `UPDATE guilds SET member_count = GREATEST(member_count - 1, 0), updated_at = NOW() WHERE id = $1`,
          [guildId]
        );
        await client.query(
          `UPDATE users SET guild_id = NULL, updated_at = NOW() WHERE id = $1`,
          [body.userId]
        );
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

    const { rows: userRows } = await db.query<{ is_admin: boolean }>(
      `SELECT is_admin FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [auth.user.sub]
    );
    if (!userRows[0]?.is_admin) throw forbidden("Administrator access required");

    const { rows: guildRows } = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM guilds WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [guildId]
    );
    if (!guildRows[0]) throw notFound("Guild not found");

    await db.transaction(async (client) => {
      await client.query(
        `UPDATE guilds SET deleted_at = NOW(), is_active = FALSE, updated_at = NOW() WHERE id = $1`,
        [guildId]
      );
      await client.query(`UPDATE users SET guild_id = NULL, updated_at = NOW() WHERE guild_id = $1`, [guildId]);
    });

    writeAuditLog({
      actorId: auth.user.sub,
      action: "admin_delete_guild",
      targetType: "guild",
      targetId: guildId,
      metadata: { guildName: guildRows[0].name },
    });

    return NextResponse.json({ success: true, data: { guildId, deleted: true } });
  } catch (err) {
    return handleApiError(err);
  }
});
