export const dynamic = 'force-dynamic';

/**
 * app/api/reports/route.ts
 *
 * POST /api/reports — Submit a content or user report.
 *
 * Accepts: reportedUserId, reportedMessageId, reportedRoomId,
 *          reportedGuildId, reportType, description
 *
 * After storing the report the route fires an AI classification job
 * (DeepSeek primary, Gemini fallback) and persists the returned category
 * and confidence score. The response is always 200 — the reporter never
 * learns about moderation outcomes.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";
import { classifyReport, type ReportType } from "@/lib/moderation/aiClassifier";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ReportBodySchema = z.object({
  /** UUID of the user being reported (optional — at least one target required). */
  reportedUserId: z.string().uuid().optional(),
  /** UUID of the message being reported. */
  reportedMessageId: z.string().uuid().optional(),
  /** UUID of the room being reported. */
  reportedRoomId: z.string().uuid().optional(),
  /** UUID of the guild being reported. */
  reportedGuildId: z.string().uuid().optional(),
  /** Category selected by the reporter. */
  reportType: z.enum([
    "spam",
    "harassment",
    "hate_speech",
    "violence",
    "sexual_content",
    "misinformation",
    "self_harm",
    "scam",
    "other",
  ]),
  /** Reporter's free-text description (capped at 1000 chars). */
  description: z.string().max(1000).optional(),
});

type ReportBody = z.infer<typeof ReportBodySchema>;

// ---------------------------------------------------------------------------
// POST /api/reports
// ---------------------------------------------------------------------------

/**
 * Submit a report against a user, message, room, or guild.
 *
 * The response is deliberately vague to prevent reporters from gaming the
 * system or inferring moderation outcomes.
 *
 * @returns 200 on success (regardless of AI classification result)
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await req.json().catch(() => ({}));
    const parsed = ReportBodySchema.safeParse(body);
    if (!parsed.success) {
      // Return 200 even on validation error — don't leak schema details
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const data: ReportBody = parsed.data;

    // At least one target must be specified
    if (
      !data.reportedUserId &&
      !data.reportedMessageId &&
      !data.reportedRoomId &&
      !data.reportedGuildId
    ) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // Prevent self-reporting
    if (data.reportedUserId === auth.user.sub) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // Build the content string for AI classification
    const contentForClassification = [
      data.description ?? "",
      data.reportType,
    ]
      .filter(Boolean)
      .join(" | ");

    // Insert the report first so we have an ID
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO moderation_reports
         (reporter_id, reported_user_id, reported_message_id,
          reported_room_id, reported_guild_id, report_type,
          description, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
       RETURNING id`,
      [
        auth.user.sub,
        data.reportedUserId ?? null,
        data.reportedMessageId ?? null,
        data.reportedRoomId ?? null,
        data.reportedGuildId ?? null,
        data.reportType,
        data.description ?? null,
      ]
    );

    const reportId = rows[0]?.id;

    // Run AI classification async — don't block the response
    if (reportId) {
      classifyReport(contentForClassification, data.reportType as ReportType)
        .then(async (classification) => {
          await db.query(
            `UPDATE moderation_reports
             SET ai_category   = $1,
                 ai_confidence = $2,
                 ai_recommendation = $3,
                 ai_provider   = $4,
                 ai_classified_at = NOW()
             WHERE id = $5`,
            [
              classification.category,
              classification.confidence,
              classification.recommendation,
              classification.provider,
              reportId,
            ]
          );
        })
        .catch((err) => {
          console.error("[reports] AI classification failed:", err);
        });
    }

    // Always return 200 — reporter should not know moderation details
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
