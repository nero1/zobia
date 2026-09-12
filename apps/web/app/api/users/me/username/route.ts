export const dynamic = 'force-dynamic';

/**
 * app/api/users/me/username/route.ts
 *
 * GET  /api/users/me/username  — eligibility, cost and cooldown info for the
 *      Username Change settings section (drives whether the "Change
 *      username" affordance is shown/enabled, and its price).
 * POST /api/users/me/username  — confirm a username change. Body:
 *      { username, currency?: "credits"|"stars", redirectEnabled: boolean }
 *
 * All real enforcement (eligibility, cooldown, availability, charging) is
 * re-checked server-side inside a single DB transaction by
 * lib/username/service.ts — this route is a thin, validated wrapper.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { checkUsernameChangeEligibility } from "@/lib/username/eligibility";
import { changeUsername } from "@/lib/username/service";
import { logger } from "@/lib/logger";

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const eligibility = await checkUsernameChangeEligibility(auth.user.sub);
    return NextResponse.json({
      success: true,
      data: {
        eligible: eligibility.eligible,
        reason: eligibility.reason ?? null,
        nextEligibleAt: eligibility.nextEligibleAt,
        cooldownActive: eligibility.cooldownActive,
        costCredits: eligibility.config.costCredits,
        costStars: eligibility.config.costStars,
        cooldownDays: eligibility.config.cooldownDays,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

const changeUsernameSchema = z.object({
  username: z.string().min(3).max(30),
  currency: z.enum(["credits", "stars"]).optional(),
  redirectEnabled: z.boolean(),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const body = await validateBody(req, changeUsernameSchema);

    const result = await changeUsername({
      userId: auth.user.sub,
      newUsername: body.username,
      currency: body.currency ?? null,
      redirectEnabled: body.redirectEnabled,
    });

    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    logger.warn({ err, userId: auth.user.sub }, "[username] change failed");
    return handleApiError(err);
  }
});
