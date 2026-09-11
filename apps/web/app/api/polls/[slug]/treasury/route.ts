export const dynamic = "force-dynamic";

/**
 * app/api/polls/[slug]/treasury/route.ts
 *
 * GET  /api/polls/:slug/treasury — current pot state (public to any signed-in viewer)
 * POST /api/polls/:slug/treasury — creator/admin funds (or tops up) the pot
 *   { amount: number, maxClaimants: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getPollIdBySlug, getPollTreasury, fundPollTreasury } from "@/lib/polls/service";
import { isUserModeratorOrAdmin } from "@/lib/forum/service";

const fundSchema = z.object({
  amount: z.number().int().min(1).max(1_000_000),
  maxClaimants: z.number().int().min(1).max(10_000),
});

export const GET = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const pollId = await getPollIdBySlug(params.slug);
    if (!pollId) throw notFound("Poll not found");
    const treasury = await getPollTreasury(pollId);
    return NextResponse.json({ success: true, data: treasury, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pollQuizWrite);
    const pollId = await getPollIdBySlug(params.slug);
    if (!pollId) throw notFound("Poll not found");
    const body = await validateBody(req, fundSchema);
    const isMod = await isUserModeratorOrAdmin(auth.user.sub);
    const treasury = await fundPollTreasury(auth.user.sub, pollId, body.amount, body.maxClaimants, isMod);
    return NextResponse.json({ success: true, data: treasury, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
