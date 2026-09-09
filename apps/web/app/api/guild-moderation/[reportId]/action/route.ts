export const dynamic = 'force-dynamic';

/**
 * app/api/guild-moderation/[reportId]/action/route.ts
 *
 * POST /api/guild-moderation/[reportId]/action — Forum Mod action on a
 * guild-scoped report (reported_guild_id / reported_guild_message_id).
 *
 * Actions: dismiss, warn, remove_content, mute_member, kick_member — no
 * sitewide actions (ban_user/suspend_user/escalate_ai) are available here;
 * those stay on the platform queue (app/api/admin/moderation/*). The
 * guild's captain and platform Admins may always act regardless of the
 * admin-configured guildModActions flags; any other Forum Mod is gated by
 * them (see lib/moderation/capabilities.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";
import { getStaffRoles } from "@/lib/auth/roles";
import { canGuildModPerform } from "@/lib/moderation/capabilities";
import { applyReportRewards, applyMaliciousReportPenalty } from "@/lib/moderation/rewards";

const ActionBodySchema = z.object({
  action: z.enum(["dismiss", "warn", "remove_content", "mute_member", "kick_member"]),
  note: z.string().max(500).optional(),
  /** Required for mute_member. */
  duration_hours: z.number().int().positive().optional(),
  /** Only meaningful with action: "dismiss". */
  mark_malicious: z.boolean().optional(),
});

interface ReportRow {
  id: string;
  status: string;
  reporter_id: string | null;
  reported_user_id: string | null;
  reported_guild_id: string | null;
  reported_guild_message_id: string | null;
}

export const POST = withAuth<{ reportId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { reportId } = await params;

    const body = await req.json().catch(() => ({}));
    const parsed = ActionBodySchema.safeParse(body);
    if (!parsed.success) throw badRequest("Invalid action payload", parsed.error.flatten());
    const { action, note, duration_hours, mark_malicious } = parsed.data;

    const { rows: reportRows } = await db.query<ReportRow>(
      `SELECT r.id, r.status, r.reporter_id, r.reported_user_id, r.reported_guild_id, r.reported_guild_message_id
       FROM moderation_reports r
       WHERE r.id = $1 AND deleted_at IS NULL
         AND (r.reported_guild_id IS NOT NULL OR r.reported_guild_message_id IS NOT NULL)`,
      [reportId]
    );
    const report = reportRows[0];
    if (!report) throw notFound("Report not found");
    if (report.status !== "pending") throw badRequest(`Report is already ${report.status}`);

    // Resolve which guild this report belongs to and the target user (the
    // reported user directly, or the sender of the reported guild message).
    const { rows: resolvedRows } = await db.query<{ guild_id: string; sender_id: string | null }>(
      `SELECT COALESCE($2::uuid, gmsg.guild_id) AS guild_id, gmsg.sender_id
       FROM moderation_reports r
       LEFT JOIN guild_messages gmsg ON gmsg.id = r.reported_guild_message_id
       WHERE r.id = $1`,
      [reportId, report.reported_guild_id]
    );
    const guildId = resolvedRows[0]?.guild_id;
    if (!guildId) throw notFound("Guild not found for this report");
    const targetUserId = report.reported_user_id ?? resolvedRows[0]?.sender_id ?? null;

    const { rows: guildRows } = await db.query<{ captain_id: string }>(
      `SELECT captain_id FROM guilds WHERE id = $1 AND is_active = TRUE`,
      [guildId]
    );
    const guild = guildRows[0];
    if (!guild) throw notFound("Guild not found");

    const roles = await getStaffRoles(auth.user.sub);
    const isCaptain = guild.captain_id === auth.user.sub;

    if (!roles.isAdmin && !isCaptain) {
      const { rows: memberRows } = await db.query<{ is_moderator: boolean }>(
        `SELECT is_moderator FROM guild_members WHERE guild_id = $1 AND user_id = $2 AND left_at IS NULL LIMIT 1`,
        [guildId, auth.user.sub]
      );
      if (!memberRows[0]?.is_moderator) {
        throw forbidden("You are not a Forum Mod of this guild.", "NOT_A_FORUM_MOD");
      }
      if (!(await canGuildModPerform(action))) {
        throw forbidden(`Forum Mods are not currently permitted to take the "${action}" action. Ask the guild captain or an administrator.`, "MOD_CAPABILITY_DISABLED");
      }
    }

    if (action === "mute_member" && !duration_hours) {
      throw badRequest("duration_hours is required for mute_member");
    }
    if ((action === "mute_member" || action === "kick_member") && !targetUserId) {
      throw badRequest(`${action} requires a target user, but this report has none.`);
    }

    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO moderation_actions (report_id, target_user_id, action_type, reason, duration_hours, moderator_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [reportId, targetUserId, action, note ?? null, duration_hours ?? null, auth.user.sub]
      );

      const resolvedStatus = action === "dismiss" ? "dismissed" : "resolved";
      await tx.query(
        `UPDATE moderation_reports SET status = $1, resolved_at = NOW(), resolved_by = $2, resolution_note = $3 WHERE id = $4`,
        [resolvedStatus, auth.user.sub, note ?? null, reportId]
      );

      if (action === "warn" && targetUserId) {
        await tx.query(`UPDATE users SET warning_count = COALESCE(warning_count, 0) + 1 WHERE id = $1`, [targetUserId]);
      } else if (action === "remove_content" && report.reported_guild_message_id) {
        await tx.query(`UPDATE guild_messages SET is_deleted = true, deleted_by = $1 WHERE id = $2`, [auth.user.sub, report.reported_guild_message_id]);
      } else if (action === "mute_member" && targetUserId && duration_hours) {
        const mutedUntil = new Date(Date.now() + duration_hours * 60 * 60 * 1000).toISOString();
        await tx.query(
          `UPDATE guild_members SET is_muted = true, muted_until = $1 WHERE guild_id = $2 AND user_id = $3`,
          [mutedUntil, guildId, targetUserId]
        );
      } else if (action === "kick_member" && targetUserId) {
        const kicked = await tx.query(`DELETE FROM guild_members WHERE guild_id = $1 AND user_id = $2`, [guildId, targetUserId]);
        if (kicked.rowCount > 0) {
          await tx.query(`UPDATE guilds SET member_count = GREATEST(member_count - 1, 0), updated_at = NOW() WHERE id = $1`, [guildId]);
          await tx.query(`UPDATE users SET guild_id = NULL, updated_at = NOW() WHERE id = $1`, [targetUserId]);
        }
      }

      if (action === "dismiss" && mark_malicious) {
        await tx.query(`UPDATE moderation_reports SET is_malicious = true WHERE id = $1`, [reportId]);
      }
    });

    if (action === "dismiss" && mark_malicious) {
      await applyMaliciousReportPenalty(reportId);
    } else {
      await applyReportRewards(reportId, action === "dismiss" ? "not_accepted" : "accepted");
    }

    if (report.reporter_id) {
      await db.query(
        `INSERT INTO notifications (user_id, type, payload, is_read, created_at) VALUES ($1, 'report_resolved', $2, false, NOW())`,
        [report.reporter_id, JSON.stringify({ reportId, outcome: action === "dismiss" ? "dismissed" : "resolved" })]
      ).catch(() => {});
    }

    return NextResponse.json({ ok: true, reportId, action, applied_at: new Date().toISOString() });
  } catch (err) {
    return handleApiError(err);
  }
});
