export const dynamic = 'force-dynamic';

/**
 * app/api/admin/moderation/[reportId]/action/route.ts
 *
 * POST /api/admin/moderation/[reportId]/action — Take a moderation action.
 *
 * Actions:
 *  - dismiss          — No violation found; close the report
 *  - warn             — Issue a warning to the reported user
 *  - remove_content   — Delete the reported message/content
 *  - suspend_user     — Temporarily suspend the reported user
 *  - ban_user         — Permanently ban the reported user (admin only)
 *  - escalate_ai      — Re-run AI analysis for a contested report (admin only, costs an API call)
 *
 * Auth: moderator or admin (withModeratorOrAdminAuth) — mirrors
 * app/api/admin/forum/queue/[reportId]/action/route.ts's mod/admin split.
 * All actions are logged to moderation_actions (with moderator_id) for the
 * audit trail — this is also how the Moderation Center attributes each
 * resolved report to the mod/admin who acted on it.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, isNull, and, sql } from "drizzle-orm";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { DEEPSEEK_MODELS, GEMINI_MODELS, GEMINI_CONFIG } from "@/lib/ai/config";
import { revokeUserAccess } from "@/lib/auth/session";
import { canPlatformModPerform } from "@/lib/moderation/capabilities";
import { applyReportRewards, applyMaliciousReportPenalty } from "@/lib/moderation/rewards";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ActionBodySchema = z.object({
  action: z.enum([
    "dismiss",
    "warn",
    "remove_content",
    "suspend_user",
    "ban_user",
    "escalate_ai",  // Layer-3: re-escalate to DeepSeek/Gemini for AI re-analysis
  ]),
  /** Optional moderator note, visible in audit log. */
  note: z.string().max(500).optional(),
  /** Duration in hours — required for suspend_user. */
  duration_hours: z.number().int().positive().optional(),
  /**
   * Only meaningful with action: "dismiss" — flags the report itself as
   * malicious/spammy, docking the original reporter's Trust Score instead
   * of paying the usual "not accepted" XP consolation (PRD "REPORTING").
   */
  mark_malicious: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Layer-3 AI Escalation — re-analyze with DeepSeek/Gemini for appeals
// ---------------------------------------------------------------------------

interface AiEscalationResult {
  provider: string;
  verdict: "violation" | "borderline" | "no_violation";
  confidence: number;
  reasoning: string;
}

/**
 * Triggers a secondary AI model (DeepSeek via OpenAI-compatible API, fallback Gemini)
 * to re-analyze contested moderation decisions. Used for appeals processing.
 */
async function triggerAiEscalation(
  orm: DbOrTx,
  reportId: string,
  adminId: string
): Promise<AiEscalationResult | null> {
  // Load report + original message content for context
  const [report] = await orm
    .select({
      report_type: schema.moderationReports.reportType,
      content: schema.messages.content,
      status: schema.moderationReports.status,
    })
    .from(schema.moderationReports)
    .leftJoin(schema.messages, eq(schema.messages.id, schema.moderationReports.reportedMessageId))
    .where(eq(schema.moderationReports.id, reportId))
    .limit(1);
  if (!report) return null;

  const prompt = `You are a content moderation AI. Review the following reported content and determine if it violates community guidelines.

Report reason: ${report.report_type}
<reported_content>
${report.content ?? "(no content attached)"}
</reported_content>

Respond with JSON: { "verdict": "violation"|"borderline"|"no_violation", "confidence": 0-1, "reasoning": "brief explanation" }`;

  // Try DeepSeek first (OpenAI-compatible API)
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    try {
      const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${deepseekKey}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODELS.CHAT,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          temperature: 0.2,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
        const result: AiEscalationResult = {
          provider: "deepseek",
          verdict: parsed.verdict ?? "borderline",
          confidence: parsed.confidence ?? 0.5,
          reasoning: parsed.reasoning ?? "",
        };
        // Save escalation result to DB
        await orm
          .insert(schema.moderationAiEscalations)
          .values({
            reportId,
            adminId,
            provider: result.provider,
            verdict: result.verdict,
            confidence: result.confidence.toString(),
            reasoning: result.reasoning,
          })
          .onConflictDoNothing()
          .catch(() => {});
        return result;
      }
    } catch {
      // Fall through to Gemini
    }
  }

  // Fallback: Google Gemini
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const res = await fetch(
        `${GEMINI_CONFIG.apiBaseUrl}/models/${GEMINI_MODELS.FLASH}:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2 },
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
        const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
        const result: AiEscalationResult = {
          provider: "gemini",
          verdict: parsed.verdict ?? "borderline",
          confidence: parsed.confidence ?? 0.5,
          reasoning: parsed.reasoning ?? "",
        };
        await orm
          .insert(schema.moderationAiEscalations)
          .values({
            reportId,
            adminId,
            provider: result.provider,
            verdict: result.verdict,
            confidence: result.confidence.toString(),
            reasoning: result.reasoning,
          })
          .onConflictDoNothing()
          .catch(() => {});
        return result;
      }
    } catch {
      // Both providers failed
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// POST /api/admin/moderation/[reportId]/action
// ---------------------------------------------------------------------------

/**
 * Apply a moderation action to a pending report.
 *
 * Records the action in moderation_actions and updates the report status.
 * For suspend_user/ban_user, updates the users table accordingly.
 * For remove_content, soft-deletes the referenced message.
 *
 * @returns Updated report status + action record
 */
export const POST = withModeratorOrAdminAuth<{ reportId: string }>(
  async (req: NextRequest, { auth, params }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

      const { reportId } = await params;

      const body = await req.json().catch(() => ({}));
      const parsed = ActionBodySchema.safeParse(body);
      if (!parsed.success) {
        throw badRequest("Invalid action payload", parsed.error.flatten());
      }

      const { action, note, duration_hours, mark_malicious } = parsed.data;

      // Admins may always take any action; a non-admin Platform Mod is
      // gated by the admin-configured capability set (/gate44/moderation/settings).
      if (!auth.isAdmin && !(await canPlatformModPerform(action))) {
        throw forbidden(
          `Platform Mods are not currently permitted to take the "${action}" action. Ask an administrator to enable it.`,
          "MOD_CAPABILITY_DISABLED"
        );
      }

      if (action === "suspend_user" && !duration_hours) {
        throw badRequest("duration_hours is required for suspend_user");
      }

      const orm = await getDb();

      // Load the report
      const [report] = await orm
        .select({
          id: schema.moderationReports.id,
          reported_user_id: schema.moderationReports.reportedUserId,
          reported_message_id: schema.moderationReports.reportedMessageId,
          reported_guild_message_id: schema.moderationReports.reportedGuildMessageId,
          reporter_id: schema.moderationReports.reporterId,
          status: schema.moderationReports.status,
        })
        .from(schema.moderationReports)
        .where(and(eq(schema.moderationReports.id, reportId), isNull(schema.moderationReports.deletedAt)))
        .limit(1);

      if (!report) {
        throw notFound("Report not found");
      }

      if (report.status !== "pending" && action !== "escalate_ai") {
        throw badRequest(`Report is already ${report.status}`);
      }

      // escalate_ai bypasses the normal action flow — handle immediately
      if (action === "escalate_ai") {
        const aiAnalysis = await triggerAiEscalation(orm, reportId, auth.user.sub).catch(() => null);
        await orm
          .update(schema.moderationReports)
          .set({ status: "escalated", updatedAt: new Date() })
          .where(eq(schema.moderationReports.id, reportId))
          .catch(() => {});
        return NextResponse.json({
          ok: true,
          reportId,
          action,
          applied_at: new Date().toISOString(),
          aiEscalation: aiAnalysis,
        });
      }

      // Execute within a transaction
      await orm.transaction(async (tx) => {
        // 1. Log the moderation action
        await tx.insert(schema.moderationActions).values({
          reportId,
          targetUserId: report.reported_user_id ?? null,
          actionType: action,
          reason: note ?? null,
          durationHours: duration_hours ?? null,
          moderatorId: auth.user.sub,
        });

        // 2. Update report status
        const resolvedStatus =
          action === "dismiss" ? "dismissed" : "resolved";
        await tx
          .update(schema.moderationReports)
          .set({
            status: resolvedStatus,
            resolvedAt: new Date(),
            resolvedBy: auth.user.sub,
            resolutionNote: note ?? null,
          })
          .where(eq(schema.moderationReports.id, reportId));

        // 3. Apply side effects
        if (report.reported_user_id) {
          if (action === "warn") {
            await tx
              .update(schema.users)
              .set({ warningCount: sql`COALESCE(${schema.users.warningCount}, 0) + 1` })
              .where(eq(schema.users.id, report.reported_user_id));
          } else if (action === "suspend_user" && duration_hours) {
            const suspendUntil = new Date(
              Date.now() + duration_hours * 60 * 60 * 1000
            );
            await tx
              .update(schema.users)
              .set({ suspendedUntil: suspendUntil, isSuspended: true })
              .where(eq(schema.users.id, report.reported_user_id));
          } else if (action === "ban_user") {
            await tx
              .update(schema.users)
              .set({ isBanned: true, bannedAt: new Date(), bannedBy: auth.user.sub })
              .where(eq(schema.users.id, report.reported_user_id));
          }
        }

        // 4. Remove content if requested
        if (action === "remove_content" && report.reported_message_id) {
          await tx
            .update(schema.messages)
            .set({ deletedAt: new Date(), deletedBy: auth.user.sub })
            .where(eq(schema.messages.id, report.reported_message_id));
        } else if (action === "remove_content" && report.reported_guild_message_id) {
          await tx
            .update(schema.guildMessages)
            .set({ isDeleted: true, deletedBy: auth.user.sub })
            .where(eq(schema.guildMessages.id, report.reported_guild_message_id));
        }

        // 5. Malicious/spammy report — flags the report, docks the original
        // reporter's Trust Score instead of the usual reward (dismiss only).
        if (action === "dismiss" && mark_malicious) {
          await tx
            .update(schema.moderationReports)
            .set({ isMalicious: true })
            .where(eq(schema.moderationReports.id, reportId));
        }
      });

      // Invalidate all active sessions for banned/suspended users so they cannot
      // continue using the platform after the action takes effect.
      if (report.reported_user_id && (action === "ban_user" || action === "suspend_user")) {
        await revokeUserAccess(report.reported_user_id, "moderation_action");
      }

      // Reporting rewards (PRD "REPORTING") — best-effort, after commit.
      if (action === "dismiss" && mark_malicious) {
        await applyMaliciousReportPenalty(reportId);
      } else {
        await applyReportRewards(reportId, action === "dismiss" ? "not_accepted" : "accepted");
      }

      // Notify the reporter of the outcome
      if (report.reporter_id) {
        const outcomeLabel =
          action === "dismiss" ? "dismissed" :
          action === "ban_user" ? "resulted in a ban" :
          action === "suspend_user" ? "resulted in a suspension" :
          action === "remove_content" ? "resulted in content removal" :
          "resolved";
        await orm
          .insert(schema.notifications)
          .values({
            userId: report.reporter_id,
            type: "report_resolved",
            payload: { reportId, outcome: outcomeLabel },
            isRead: false,
          })
          .catch(() => {});
      }

      return NextResponse.json({
        ok: true,
        reportId,
        action,
        applied_at: new Date().toISOString(),
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
