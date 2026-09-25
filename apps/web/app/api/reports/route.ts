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
import { eq, inArray, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb, schema } from "@/lib/db/drizzle";
import { classifyReport, type ReportType } from "@/lib/moderation/aiClassifier";
import { computeClusterKey, findExistingCluster, registerFirstReporter, maybeAutoQuarantine, maybeRaiseReportSpikeAlert } from "@/lib/moderation/clustering";
import { logger } from "@/lib/logger";

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
  /** UUID of the guild chat message being reported. */
  reportedGuildMessageId: z.string().uuid().optional(),
  /** UUID of the forum question being reported. */
  reportedForumQuestionId: z.string().uuid().optional(),
  /** UUID of the forum answer being reported. */
  reportedForumAnswerId: z.string().uuid().optional(),
  /** UUID of the old-school BB-forum thread being reported. */
  reportedBbThreadId: z.string().uuid().optional(),
  /** UUID of the old-school BB-forum post being reported. */
  reportedBbPostId: z.string().uuid().optional(),
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
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
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
      !data.reportedGuildId &&
      !data.reportedGuildMessageId &&
      !data.reportedForumQuestionId &&
      !data.reportedForumAnswerId &&
      !data.reportedBbThreadId &&
      !data.reportedBbPostId
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

    // Flood control: fold a report against a target that's already pending
    // review into the existing report instead of creating a new queue entry
    // (see lib/moderation/clustering.ts). Only a brand-new cluster runs AI
    // classification — a duplicate just adds this user as a reporter.
    const clusterKey = computeClusterKey(data);
    let reportId: string | undefined;

    const orm = await getDb();

    if (clusterKey) {
      const joined = await orm.transaction(async (tx) => {
        const existing = await findExistingCluster(tx, clusterKey, auth.user.sub);
        if (existing) {
          await maybeAutoQuarantine(tx, existing.reportId, clusterKey, existing.duplicateCount);
          await maybeRaiseReportSpikeAlert(tx, clusterKey, existing.duplicateCount);
          return existing.reportId;
        }
        return null;
      });
      if (joined) {
        // Already reported by someone else and still pending — nothing more to do.
        return NextResponse.json({ ok: true }, { status: 200 });
      }
    }

    // Insert the report first so we have an ID
    const rows = await orm
      .insert(schema.moderationReports)
      .values({
        reporterId: auth.user.sub,
        reportedUserId: data.reportedUserId ?? null,
        reportedMessageId: data.reportedMessageId ?? null,
        reportedRoomId: data.reportedRoomId ?? null,
        reportedGuildId: data.reportedGuildId ?? null,
        reportedGuildMessageId: data.reportedGuildMessageId ?? null,
        reportedForumQuestionId: data.reportedForumQuestionId ?? null,
        reportedForumAnswerId: data.reportedForumAnswerId ?? null,
        reportedBbThreadId: data.reportedBbThreadId ?? null,
        reportedBbPostId: data.reportedBbPostId ?? null,
        reportType: data.reportType,
        description: data.description ?? null,
        status: "pending",
        clusterKey,
      })
      .returning({ id: schema.moderationReports.id });

    reportId = rows[0]?.id;
    if (reportId) {
      await registerFirstReporter(orm, reportId, auth.user.sub);
    }

    // Run AI classification async — routes to correct pipeline stage based on confidence
    if (reportId) {
      classifyReport(contentForClassification, data.reportType as ReportType)
        .then(async (classification) => {
          // Load thresholds from x_manifest (with fallback defaults)
          const thresholdRows = await orm
            .select({ key: schema.xManifest.key, value: schema.xManifest.value })
            .from(schema.xManifest)
            .where(
              inArray(schema.xManifest.key, [
                "ai_moderation_auto_action_threshold",
                "ai_moderation_community_threshold",
              ])
            );
          const thresholdMap = Object.fromEntries(thresholdRows.map((r) => [r.key, r.value]));
          const autoActionThreshold = parseFloat(thresholdMap['ai_moderation_auto_action_threshold'] ?? '0.9');
          const communityThreshold = parseFloat(thresholdMap['ai_moderation_community_threshold'] ?? '0.7');

          const autoActionRecommendations = ['remove_content', 'suspend_user', 'ban_user'];
          let pipelineStatus: string;

          if (
            classification.confidence >= autoActionThreshold &&
            autoActionRecommendations.includes(classification.recommendation)
          ) {
            // Auto-action: hide content or flag for immediate review
            pipelineStatus = 'ai_auto_actioned';
            // Flag the reported content as hidden (best-effort)
            if (data.reportedMessageId) {
              await orm
                .update(schema.messages)
                .set({ isDeleted: true, updatedAt: sql`NOW()` })
                .where(eq(schema.messages.id, data.reportedMessageId))
                .catch(() => {});
            }
            if (data.reportedRoomId && classification.recommendation === 'ban_user') {
              // Suspend reported user from the room (non-destructive)
              await orm
                .update(schema.roomMembers)
                .set({ isMuted: true, updatedAt: sql`NOW()` })
                .where(
                  sql`${schema.roomMembers.roomId} = ${data.reportedRoomId} AND ${schema.roomMembers.userId} = ${data.reportedUserId ?? null}`
                )
                .catch(() => {});
            }
          } else if (classification.confidence >= communityThreshold) {
            pipelineStatus = 'community_review';
            // Create a community note for crowd review
            if (data.reportedUserId) {
              await orm
                .insert(schema.communityNotes)
                .values({
                  targetType: data.reportedMessageId ? 'message' : data.reportedRoomId ? 'room' : 'user',
                  targetId: (data.reportedMessageId ?? data.reportedRoomId ?? data.reportedGuildId ?? data.reportedUserId) as string,
                  authorId: auth.user.sub,
                  content: `AI flagged: ${classification.category} (confidence ${Math.round(classification.confidence * 100)}%)`,
                  status: 'needs_review',
                })
                .onConflictDoNothing()
                .catch(() => {});
            }
          } else {
            pipelineStatus = 'manual_queue';
          }

          await orm
            .update(schema.moderationReports)
            .set({
              aiCategory: classification.category,
              aiConfidence: String(classification.confidence),
              aiRecommendation: classification.recommendation,
              aiProvider: classification.provider,
              aiClassifiedAt: sql`NOW()`,
              pipelineStatus,
              status: sql`CASE WHEN ${pipelineStatus} = 'ai_auto_actioned' THEN 'resolved' ELSE status END`,
            })
            .where(eq(schema.moderationReports.id, reportId as string));
        })
        .catch((err) => {
          logger.error({ err: err }, "[reports] AI classification/pipeline failed:");
        });
    }

    // Always return 200 — reporter should not know moderation details
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
