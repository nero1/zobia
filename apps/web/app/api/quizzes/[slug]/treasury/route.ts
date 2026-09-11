export const dynamic = "force-dynamic";

/**
 * app/api/quizzes/[slug]/treasury/route.ts
 *
 * GET  /api/quizzes/:slug/treasury — current pot state
 * POST /api/quizzes/:slug/treasury — creator/admin funds (or tops up) the
 *   pot that the first `maxClaimants` users who PASS split evenly.
 *   { amount: number, maxClaimants: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getQuizIdBySlug, getQuizTreasury, fundQuizTreasury } from "@/lib/quizzes/service";
import { isUserModeratorOrAdmin } from "@/lib/forum/service";

const fundSchema = z.object({
  amount: z.number().int().min(1).max(1_000_000),
  maxClaimants: z.number().int().min(1).max(10_000),
});

export const GET = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const quizId = await getQuizIdBySlug(params.slug);
    if (!quizId) throw notFound("Quiz not found");
    const treasury = await getQuizTreasury(quizId);
    return NextResponse.json({ success: true, data: treasury, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pollQuizWrite);
    const quizId = await getQuizIdBySlug(params.slug);
    if (!quizId) throw notFound("Quiz not found");
    const body = await validateBody(req, fundSchema);
    const isMod = await isUserModeratorOrAdmin(auth.user.sub);
    const treasury = await fundQuizTreasury(auth.user.sub, quizId, body.amount, body.maxClaimants, isMod);
    return NextResponse.json({ success: true, data: treasury, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
