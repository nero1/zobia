export const dynamic = "force-dynamic";

/**
 * POST /api/economy/subscriptions/cancel-feedback
 *
 * Optional exit survey shown right after a subscription cancels
 * (components/settings/CancelPlanModal.tsx). Every field is optional —
 * the cancellation itself already happened via
 * DELETE /api/economy/subscriptions/[subscriptionId]; this is purely
 * product feedback.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { logger } from "@/lib/logger";

const REASON_KEYS = ["errors_bugs", "missing_features", "temporary_break", "too_expensive", "other"] as const;

const BodySchema = z.object({
  reasons: z.array(z.enum(REASON_KEYS)).max(REASON_KEYS.length).default([]),
  followUps: z.record(z.string().max(500)).default({}),
  generalFeedback: z.string().max(500).nullable().default(null),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const body = await validateBody(req, BodySchema);

    const { rows } = await db.query<{ plan: string }>(
      `SELECT plan FROM users WHERE id = $1`,
      [auth.user.sub]
    );

    await db.query(
      `INSERT INTO subscription_cancellation_feedback (user_id, plan, reasons, follow_ups, general_feedback, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, NOW())`,
      [
        auth.user.sub,
        rows[0]?.plan ?? null,
        body.reasons,
        JSON.stringify(body.followUps),
        body.generalFeedback,
      ]
    );

    logger.info({ userId: auth.user.sub, reasons: body.reasons }, "[subscriptions] cancellation feedback submitted");
    return NextResponse.json({ success: true, data: null, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
