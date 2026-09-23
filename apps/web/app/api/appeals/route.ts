export const dynamic = "force-dynamic";

/**
 * app/api/appeals/route.ts
 *
 * POST /api/appeals — submit a suspension/ban appeal.
 *
 * Public endpoint (the user is, by definition, blocked from logging in), but
 * identity is verified via the short-lived appeal token (`code`) issued at
 * the moment of the blocked login attempt — see lib/auth/appealToken.ts and
 * app/api/auth/google/callback and app/api/auth/telegram/callback. A public
 * "email us" form is deliberately NOT how this works.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, conflict, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp } from "@/lib/security/rateLimit";
import { consumeAppealToken } from "@/lib/auth/appealToken";
import { loadManifest } from "@/lib/manifest";
import { classifyAccountAppeal } from "@/lib/moderation/aiClassifier";
import { raiseAlert } from "@/lib/alerts/dispatch";
import { logger } from "@/lib/logger";

const AppealSubmitSchema = z.object({
  code: z.string().min(10, "Invalid appeal link"),
  reason: z
    .string()
    .min(20, "Please explain your appeal in at least 20 characters")
    .max(2000, "Appeal reason must be at most 2000 characters"),
  // Optional alternate contact — the account's own email may be inaccessible
  // (e.g. it belongs to a Telegram-only account, or the user has lost access).
  contactEmail: z.string().email("Must be a valid email address").optional().nullable(),
});

export const POST = async (req: NextRequest) => {
  try {
    const ip = getClientIp(req) ?? "unknown";
    await enforceRateLimit(`appeals:submit:${ip}`, "ip", {
      name: "appeals:submit",
      windowMs: 60 * 60 * 1000,
      limit: 5,
    });

    const body = await validateBody(req, AppealSubmitSchema);

    // Consuming the token both verifies identity (it was only ever issued to
    // the account that just proved ownership via Google/Telegram OAuth and
    // was then blocked at login) and prevents replay/duplicate submission
    // from the same blocked-login attempt.
    const payload = await consumeAppealToken(body.code);
    if (!payload) {
      throw badRequest(
        "Your appeal link has expired or was already used. Please try logging in again to get a new one.",
        "APPEAL_TOKEN_INVALID"
      );
    }

    const contactEmail = body.contactEmail ?? payload.email ?? null;
    if (!contactEmail) {
      throw badRequest(
        "Please provide a contact email so we can send you the outcome of your appeal.",
        "APPEAL_EMAIL_REQUIRED"
      );
    }

    const manifest = await loadManifest();

    // Enforce the refusal cap: once a user has been denied
    // `appeals.maxRefusals` times for this same kind of action, no further
    // appeals for it may be submitted.
    const { rows: deniedRows } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM account_appeals
       WHERE user_id = $1 AND appeal_type = $2 AND status = 'denied'`,
      [payload.userId, payload.appealType]
    );
    const deniedCount = parseInt(deniedRows[0]?.count ?? "0", 10);
    if (deniedCount >= manifest.appeals.maxRefusals) {
      throw forbidden(
        "You've reached the maximum number of appeals for this action. No further appeals can be submitted.",
        "APPEAL_LIMIT_REACHED"
      );
    }

    // Don't allow piling up a second appeal while one is still in flight.
    const { rows: pendingRows } = await db.query<{ id: string }>(
      `SELECT id FROM account_appeals
       WHERE user_id = $1 AND appeal_type = $2 AND status IN ('pending', 'under_review')
       LIMIT 1`,
      [payload.userId, payload.appealType]
    );
    if (pendingRows[0]) {
      throw conflict(
        "You already have an appeal under review. We'll email you once it's been decided.",
        "APPEAL_ALREADY_PENDING"
      );
    }

    // AI triage (optional, admin-configurable) — informs the human reviewer,
    // never auto-decides. Default mode is "manual" (no AI step at all).
    let aiTriageResult: unknown = null;
    if (manifest.appeals.triageMode === "ai_then_manual") {
      try {
        aiTriageResult = await classifyAccountAppeal(payload.appealType, payload.reason, body.reason);
      } catch (err) {
        logger.error({ err }, "[appeals] AI triage failed, continuing with manual-only review");
      }
    }

    const { rows: inserted } = await db.query<{ id: string; created_at: string }>(
      `INSERT INTO account_appeals
         (user_id, appeal_type, reason, contact_email, status, ai_triage_result, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, NOW(), NOW())
       RETURNING id, created_at`,
      [
        payload.userId,
        payload.appealType,
        body.reason,
        contactEmail,
        aiTriageResult ? JSON.stringify(aiTriageResult) : null,
      ]
    );
    const appeal = inserted[0];

    // Notify admins/moderators (fire-and-forget, non-fatal on failure).
    await raiseAlert(db, {
      type: "account_appeal",
      category: "moderation",
      priorityLevel: 4,
      title: `Account ${payload.appealType} appeal submitted`,
      message: `User ${payload.userId} submitted an appeal for their ${payload.appealType}.`,
      metadata: { appealId: appeal?.id, userId: payload.userId, appealType: payload.appealType },
      dedupeKey: `account_appeal:${appeal?.id}`,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      data: {
        appealId: appeal?.id,
        status: "pending",
        message:
          "Your appeal has been submitted. A reply may take several days and will be sent to the email you provided.",
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
};
