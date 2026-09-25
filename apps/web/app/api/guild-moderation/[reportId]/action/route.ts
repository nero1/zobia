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
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb, schema } from "@/lib/db/drizzle";
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

export const POST = withAuth<{ reportId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { reportId } = await params;

    const body = await req.json().catch(() => ({}));
    const parsed = ActionBodySchema.safeParse(body);
    if (!parsed.success) throw badRequest("Invalid action payload", parsed.error.flatten());
    const { action, note, duration_hours, mark_malicious } = parsed.data;

    const orm = await getDb();

    const [report] = await orm
      .select({
        id: schema.moderationReports.id,
        status: schema.moderationReports.status,
        reporter_id: schema.moderationReports.reporterId,
        reported_user_id: schema.moderationReports.reportedUserId,
        reported_guild_id: schema.moderationReports.reportedGuildId,
        reported_guild_message_id: schema.moderationReports.reportedGuildMessageId,
      })
      .from(schema.moderationReports)
      .where(
        and(
          eq(schema.moderationReports.id, reportId),
          isNull(schema.moderationReports.deletedAt),
          or(
            sql`${schema.moderationReports.reportedGuildId} IS NOT NULL`,
            sql`${schema.moderationReports.reportedGuildMessageId} IS NOT NULL`
          )
        )
      )
      .limit(1);
    if (!report) throw notFound("Report not found");
    if (report.status !== "pending") throw badRequest(`Report is already ${report.status}`);

    // Resolve which guild this report belongs to and the target user (the
    // reported user directly, or the sender of the reported guild message).
    const [resolved] = await orm
      .select({
        guild_id: sql<string | null>`COALESCE(${report.reported_guild_id}, ${schema.guildMessages.guildId})`,
        sender_id: schema.guildMessages.senderId,
      })
      .from(schema.moderationReports)
      .leftJoin(schema.guildMessages, eq(schema.guildMessages.id, schema.moderationReports.reportedGuildMessageId))
      .where(eq(schema.moderationReports.id, reportId))
      .limit(1);
    const guildId = resolved?.guild_id;
    if (!guildId) throw notFound("Guild not found for this report");
    const targetUserId = report.reported_user_id ?? resolved?.sender_id ?? null;

    const [guild] = await orm
      .select({ captain_id: schema.guilds.captainId })
      .from(schema.guilds)
      .where(and(eq(schema.guilds.id, guildId), eq(schema.guilds.isActive, true)))
      .limit(1);
    if (!guild) throw notFound("Guild not found");

    const roles = await getStaffRoles(auth.user.sub);
    const isCaptain = guild.captain_id === auth.user.sub;

    if (!roles.isAdmin && !isCaptain) {
      const [member] = await orm
        .select({ is_moderator: schema.guildMembers.isModerator })
        .from(schema.guildMembers)
        .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, auth.user.sub), isNull(schema.guildMembers.leftAt)))
        .limit(1);
      if (!member?.is_moderator) {
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

    // NOTE: schema.moderationActions.reportId has its FK declared against
    // the legacy `reports` table, not `moderation_reports` (see schema.ts
    // ~L4481 vs ~L4381) — the raw SQL this replaced had no compile-time FK
    // check either way, but this looks like a genuine schema.ts mismatch
    // worth flagging rather than fixing silently here.
    await orm.transaction(async (tx) => {
      await tx.insert(schema.moderationActions).values({
        reportId,
        targetUserId,
        actionType: action,
        reason: note ?? null,
        durationHours: duration_hours ?? null,
        moderatorId: auth.user.sub,
      });

      const resolvedStatus = action === "dismiss" ? "dismissed" : "resolved";
      await tx
        .update(schema.moderationReports)
        .set({ status: resolvedStatus, resolvedAt: new Date(), resolvedBy: auth.user.sub, resolutionNote: note ?? null })
        .where(eq(schema.moderationReports.id, reportId));

      if (action === "warn" && targetUserId) {
        await tx
          .update(schema.users)
          .set({ warningCount: sql`COALESCE(${schema.users.warningCount}, 0) + 1` })
          .where(eq(schema.users.id, targetUserId));
      } else if (action === "remove_content" && report.reported_guild_message_id) {
        await tx
          .update(schema.guildMessages)
          .set({ isDeleted: true, deletedBy: auth.user.sub })
          .where(eq(schema.guildMessages.id, report.reported_guild_message_id));
      } else if (action === "mute_member" && targetUserId && duration_hours) {
        const mutedUntil = new Date(Date.now() + duration_hours * 60 * 60 * 1000);
        await tx
          .update(schema.guildMembers)
          .set({ isMuted: true, mutedUntil })
          .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, targetUserId)));
      } else if (action === "kick_member" && targetUserId) {
        const kicked = await tx
          .delete(schema.guildMembers)
          .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, targetUserId)))
          .returning({ id: schema.guildMembers.id });
        if (kicked.length > 0) {
          await tx
            .update(schema.guilds)
            .set({ memberCount: sql`GREATEST(${schema.guilds.memberCount} - 1, 0)`, updatedAt: new Date() })
            .where(eq(schema.guilds.id, guildId));
          await tx
            .update(schema.users)
            .set({ guildId: null, updatedAt: new Date() })
            .where(eq(schema.users.id, targetUserId));
        }
      }

      if (action === "dismiss" && mark_malicious) {
        await tx
          .update(schema.moderationReports)
          .set({ isMalicious: true })
          .where(eq(schema.moderationReports.id, reportId));
      }
    });

    if (action === "dismiss" && mark_malicious) {
      await applyMaliciousReportPenalty(reportId);
    } else {
      await applyReportRewards(reportId, action === "dismiss" ? "not_accepted" : "accepted");
    }

    if (report.reporter_id) {
      await orm
        .insert(schema.notifications)
        .values({
          userId: report.reporter_id,
          type: "report_resolved",
          payload: { reportId, outcome: action === "dismiss" ? "dismissed" : "resolved" },
          isRead: false,
        })
        .catch(() => {});
    }

    return NextResponse.json({ ok: true, reportId, action, applied_at: new Date().toISOString() });
  } catch (err) {
    return handleApiError(err);
  }
});
