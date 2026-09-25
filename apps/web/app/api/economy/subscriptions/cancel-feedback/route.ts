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
import { eq } from "drizzle-orm";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
// NOTE: schema.subscriptionCancellationFeedback is not included in the
// aggregated `schema` object exported from lib/db/schema.ts (a genuine gap
// there — flagged, not silently fixed since schema.ts is out of scope), so
// import the table directly instead.
import { subscriptionCancellationFeedback } from "@/lib/db/schema";
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
    const orm = await getDb();

    const rows = await orm
      .select({ plan: schema.users.plan })
      .from(schema.users)
      .where(eq(schema.users.id, auth.user.sub))
      .limit(1);

    await orm.insert(subscriptionCancellationFeedback).values({
      userId: auth.user.sub,
      plan: rows[0]?.plan ?? null,
      reasons: body.reasons,
      followUps: body.followUps,
      generalFeedback: body.generalFeedback,
    });

    logger.info({ userId: auth.user.sub, reasons: body.reasons }, "[subscriptions] cancellation feedback submitted");
    return NextResponse.json({ success: true, data: null, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
