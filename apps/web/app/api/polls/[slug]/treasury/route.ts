export const dynamic = "force-dynamic";

/**
 * app/api/polls/[slug]/treasury/route.ts
 *
 * GET    /api/polls/:slug/treasury — current pot state (public to any signed-in viewer)
 * POST   /api/polls/:slug/treasury — the poll's own creator creates the pot
 *   (only when none already exists), debited from their own Credits balance
 *   { amount: number, maxClaimants: number }
 * PATCH  /api/polls/:slug/treasury — edit an existing pot's amount/max
 *   claimants; debits an increase or refunds a decrease
 *   { amount: number, maxClaimants: number }
 * DELETE /api/polls/:slug/treasury — turn the pot off, refunding unclaimed
 *   funds to the creator
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getPollIdBySlug, getPollTreasury, fundPollTreasury, editPollTreasury, closePollTreasury } from "@/lib/polls/service";

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
    const treasury = await fundPollTreasury(auth.user.sub, pollId, body.amount, body.maxClaimants);
    return NextResponse.json({ success: true, data: treasury, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const PATCH = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pollQuizWrite);
    const pollId = await getPollIdBySlug(params.slug);
    if (!pollId) throw notFound("Poll not found");
    const body = await validateBody(req, fundSchema);
    const treasury = await editPollTreasury(auth.user.sub, pollId, body.amount, body.maxClaimants);
    return NextResponse.json({ success: true, data: treasury, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pollQuizWrite);
    const pollId = await getPollIdBySlug(params.slug);
    if (!pollId) throw notFound("Poll not found");
    const treasury = await closePollTreasury(auth.user.sub, pollId);
    return NextResponse.json({ success: true, data: treasury, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
