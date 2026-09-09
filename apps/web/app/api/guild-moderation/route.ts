export const dynamic = 'force-dynamic';

/**
 * app/api/guild-moderation/route.ts
 *
 * GET /api/guild-moderation — the Forum Mod report queue: reports scoped to
 * a Guild (reported_guild_id) or a guild chat message
 * (reported_guild_message_id). A Forum Mod (guild_members.is_moderator) or
 * the guild's captain only sees reports for guild(s) they moderate; a
 * Platform Mod/admin sees every guild-scoped report across all guilds (a
 * useful cross-guild view — they can already reach any individual report
 * via the sitewide queue too).
 *
 * Mirrors GET /api/admin/moderation's shape so the Moderation Center
 * (app/(app)/watch56) can render both queues with the same components.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";
import { getStaffRoles } from "@/lib/auth/roles";

interface GuildReportRow {
  id: string;
  reporter_username: string | null;
  reported_user_username: string | null;
  guild_message_content: string | null;
  guild_id: string;
  guild_name: string;
  report_type: string;
  description: string | null;
  status: string;
  duplicate_count: number;
  created_at: string;
  resolved_at: string | null;
  resolved_by_username: string | null;
  resolution_note: string | null;
  action_id: string | null;
}

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const userId = auth.user.sub;

    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "pending";
    const validStatuses = ["pending", "resolved", "escalated", "dismissed", "all"];
    const safeStatus = validStatuses.includes(status) ? status : "pending";

    const roles = await getStaffRoles(userId);
    const isPlatformStaff = roles.isAdmin || roles.isModerator;

    let scopedGuildIds: string[] = [];
    if (!isPlatformStaff) {
      const { rows: scopeRows } = await db.query<{ guild_id: string }>(
        `SELECT guild_id FROM guild_members WHERE user_id = $1 AND is_moderator = true AND left_at IS NULL
         UNION
         SELECT id AS guild_id FROM guilds WHERE captain_id = $1 AND is_active = TRUE`,
        [userId]
      );
      scopedGuildIds = scopeRows.map((r) => r.guild_id);
      if (scopedGuildIds.length === 0) {
        throw forbidden("You do not moderate any guild.", "NOT_A_FORUM_MOD");
      }
    }

    const params: (string | string[])[] = [];
    let whereClause = `(r.reported_guild_id IS NOT NULL OR r.reported_guild_message_id IS NOT NULL)`;

    if (safeStatus !== "all") {
      params.push(safeStatus);
      whereClause += ` AND r.status = $${params.length}`;
    }
    if (!isPlatformStaff) {
      params.push(scopedGuildIds);
      whereClause += ` AND COALESCE(r.reported_guild_id, gmsg.guild_id) = ANY($${params.length})`;
    }

    const { rows } = await db.query<GuildReportRow>(
      `SELECT
         r.id,
         reporter.username AS reporter_username,
         reported.username AS reported_user_username,
         gmsg.content AS guild_message_content,
         COALESCE(r.reported_guild_id, gmsg.guild_id) AS guild_id,
         g.name AS guild_name,
         r.report_type,
         r.description,
         r.status,
         r.duplicate_count,
         r.created_at,
         r.resolved_at,
         resolver.username AS resolved_by_username,
         r.resolution_note,
         action.id AS action_id
       FROM moderation_reports r
       LEFT JOIN users reporter ON reporter.id = r.reporter_id
       LEFT JOIN users reported ON reported.id = r.reported_user_id
       LEFT JOIN guild_messages gmsg ON gmsg.id = r.reported_guild_message_id
       LEFT JOIN guilds g ON g.id = COALESCE(r.reported_guild_id, gmsg.guild_id)
       LEFT JOIN users resolver ON resolver.id = r.resolved_by
       LEFT JOIN LATERAL (
         SELECT ma.id FROM moderation_actions ma
         WHERE ma.report_id = r.id AND ma.reversed_at IS NULL
         ORDER BY ma.created_at DESC LIMIT 1
       ) action ON true
       WHERE ${whereClause}
       ORDER BY r.duplicate_count DESC, r.created_at DESC
       LIMIT 100`,
      params
    );

    return NextResponse.json({
      success: true,
      data: {
        items: rows.map((r) => ({
          id: r.id,
          reporter_username: r.reporter_username ?? "unknown",
          reported_user_username: r.reported_user_username,
          guild_message_content: r.guild_message_content,
          guild_id: r.guild_id,
          guild_name: r.guild_name,
          report_type: r.report_type,
          description: r.description,
          status: r.status,
          duplicate_count: r.duplicate_count,
          created_at: r.created_at,
          resolved_at: r.resolved_at,
          resolved_by_username: r.resolved_by_username,
          resolution_note: r.resolution_note,
          action_id: r.action_id,
        })),
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
