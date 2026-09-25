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
import { and, count, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
    const orm = await getDb();

    // Enforce the refusal cap: once a user has been denied
    // `appeals.maxRefusals` times for this same kind of action, no further
    // appeals for it may be submitted.
    const [deniedRow] = await orm
      .select({ count: count() })
      .from(schema.accountAppeals)
      .where(
        and(
          eq(schema.accountAppeals.userId, payload.userId),
          eq(schema.accountAppeals.appealType, payload.appealType),
          eq(schema.accountAppeals.status, "denied")
        )
      );
    const deniedCount = deniedRow?.count ?? 0;
    if (deniedCount >= manifest.appeals.maxRefusals) {
      throw forbidden(
        "You've reached the maximum number of appeals for this action. No further appeals can be submitted.",
        "APPEAL_LIMIT_REACHED"
      );
    }

    // Don't allow piling up a second appeal while one is still in flight.
    const [pendingRow] = await orm
      .select({ id: schema.accountAppeals.id })
      .from(schema.accountAppeals)
      .where(
        and(
          eq(schema.accountAppeals.userId, payload.userId),
          eq(schema.accountAppeals.appealType, payload.appealType),
          inArray(schema.accountAppeals.status, ["pending", "under_review"])
        )
      )
      .limit(1);
    if (pendingRow) {
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

    const [appeal] = await orm
      .insert(schema.accountAppeals)
      .values({
        userId: payload.userId,
        appealType: payload.appealType,
        reason: body.reason,
        contactEmail,
        status: "pending",
        aiTriageResult: aiTriageResult ?? null,
      })
      .returning({ id: schema.accountAppeals.id, createdAt: schema.accountAppeals.createdAt });

    // Notify admins/moderators (fire-and-forget, non-fatal on failure).
    await raiseAlert(orm, {
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
