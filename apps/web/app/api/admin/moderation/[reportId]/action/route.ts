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
 *  - ban_user         — Permanently ban the reported user
 *
 * All actions are logged to moderation_actions for audit trail.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";
import { DEEPSEEK_MODELS, GEMINI_MODELS, GEMINI_CONFIG } from "@/lib/ai/config";
import { invalidateAllSessions } from "@/lib/auth/session";

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
  reportId: string,
  adminId: string
): Promise<AiEscalationResult | null> {
  // Load report + original message content for context
  const { rows } = await db.query<{
    report_type: string; content: string | null; status: string;
  }>(
    `SELECT mr.report_type,
            m.content,
            mr.status
     FROM moderation_reports mr
     LEFT JOIN messages m ON m.id = mr.reported_message_id
     WHERE mr.id = $1 LIMIT 1`,
    [reportId]
  );
  const report = rows[0];
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
        await db.query(
          `INSERT INTO moderation_ai_escalations
             (report_id, admin_id, provider, verdict, confidence, reasoning, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT DO NOTHING`,
          [reportId, adminId, result.provider, result.verdict, result.confidence, result.reasoning]
        ).catch(() => {});
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
        await db.query(
          `INSERT INTO moderation_ai_escalations
             (report_id, admin_id, provider, verdict, confidence, reasoning, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT DO NOTHING`,
          [reportId, adminId, result.provider, result.verdict, result.confidence, result.reasoning]
        ).catch(() => {});
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
export const POST = withAdminAuth(
  async (
    req: NextRequest,
    {
      auth,
      params,
    }: {
      auth: { user: { sub: string } };
      params: { reportId: string };
    }
  ) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

      const { reportId } = params;

      const body = await req.json().catch(() => ({}));
      const parsed = ActionBodySchema.safeParse(body);
      if (!parsed.success) {
        throw badRequest("Invalid action payload", parsed.error.flatten());
      }

      const { action, note, duration_hours } = parsed.data;

      if (action === "suspend_user" && !duration_hours) {
        throw badRequest("duration_hours is required for suspend_user");
      }

      // Load the report
      const { rows: reportRows } = await db.query<{
        id: string;
        reported_user_id: string | null;
        reported_message_id: string | null;
        reporter_id: string | null;
        status: string;
      }>(
        `SELECT id, reported_user_id, reported_message_id, reporter_id, status
         FROM moderation_reports
         WHERE id = $1 AND deleted_at IS NULL`,
        [reportId]
      );

      const report = reportRows[0];
      if (!report) {
        throw notFound("Report not found");
      }

      if (report.status !== "pending" && action !== "escalate_ai") {
        throw badRequest(`Report is already ${report.status}`);
      }

      // escalate_ai bypasses the normal action flow — handle immediately
      if (action === "escalate_ai") {
        const aiAnalysis = await triggerAiEscalation(reportId, auth.user.sub).catch(() => null);
        await db.query(
          `UPDATE moderation_reports SET status = 'escalated', updated_at = NOW() WHERE id = $1`,
          [reportId]
        ).catch(() => {});
        return NextResponse.json({
          ok: true,
          reportId,
          action,
          applied_at: new Date().toISOString(),
          aiEscalation: aiAnalysis,
        });
      }

      // Execute within a transaction
      await db.transaction(async (tx) => {
        // 1. Log the moderation action
        await tx.query(
          `INSERT INTO moderation_actions
             (report_id, target_user_id, action_type, reason, duration_hours,
              moderator_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [
            reportId,
            report.reported_user_id ?? null,
            action,
            note ?? null,
            duration_hours ?? null,
            auth.user.sub,
          ]
        );

        // 2. Update report status
        const resolvedStatus =
          action === "dismiss" ? "dismissed" : "resolved";
        await tx.query(
          `UPDATE moderation_reports
           SET status        = $1,
               resolved_at   = NOW(),
               resolved_by   = $2,
               resolution_note = $3
           WHERE id = $4`,
          [resolvedStatus, auth.user.sub, note ?? null, reportId]
        );

        // 3. Apply side effects
        if (report.reported_user_id) {
          if (action === "warn") {
            await tx.query(
              `UPDATE users
               SET warning_count = COALESCE(warning_count, 0) + 1
               WHERE id = $1`,
              [report.reported_user_id]
            );
          } else if (action === "suspend_user" && duration_hours) {
            const suspendUntil = new Date(
              Date.now() + duration_hours * 60 * 60 * 1000
            ).toISOString();
            await tx.query(
              `UPDATE users
               SET suspended_until = $1, is_suspended = true
               WHERE id = $2`,
              [suspendUntil, report.reported_user_id]
            );
          } else if (action === "ban_user") {
            await tx.query(
              `UPDATE users
               SET is_banned = true, banned_at = NOW(), banned_by = $1
               WHERE id = $2`,
              [auth.user.sub, report.reported_user_id]
            );
          }
        }

        // 4. Remove content if requested
        if (
          action === "remove_content" &&
          report.reported_message_id
        ) {
          await tx.query(
            `UPDATE messages
             SET deleted_at = NOW(), deleted_by = $1
             WHERE id = $2`,
            [auth.user.sub, report.reported_message_id]
          );
        }
      });

      // Invalidate all active sessions for banned/suspended users so they cannot
      // continue using the platform after the action takes effect.
      if (report.reported_user_id && (action === "ban_user" || action === "suspend_user")) {
        await invalidateAllSessions(report.reported_user_id).catch(() => {});
      }

      // Notify the reporter of the outcome
      if (report.reporter_id) {
        const outcomeLabel =
          action === "dismiss" ? "dismissed" :
          action === "ban_user" ? "resulted in a ban" :
          action === "suspend_user" ? "resulted in a suspension" :
          action === "remove_content" ? "resulted in content removal" :
          "resolved";
        await db.query(
          `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
           VALUES ($1, 'report_resolved', $2, false, NOW())`,
          [
            report.reporter_id,
            JSON.stringify({ reportId, outcome: outcomeLabel }),
          ]
        ).catch(() => {});
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
