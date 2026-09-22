export const dynamic = "force-dynamic";

/**
 * app/api/quizzes/[slug]/treasury/route.ts
 *
 * GET    /api/quizzes/:slug/treasury — current pot state
 * POST   /api/quizzes/:slug/treasury — the quiz's own creator creates the
 *   pot (only when none already exists), debited from their own Credits
 *   balance, that the first `maxClaimants` users who PASS split evenly.
 *   { amount: number, maxClaimants: number }
 * PATCH  /api/quizzes/:slug/treasury — edit an existing pot's amount/max
 *   claimants; debits an increase or refunds a decrease
 * DELETE /api/quizzes/:slug/treasury — turn the pot off, refunding
 *   unclaimed funds to the creator
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getQuizIdBySlug, getQuizTreasury, fundQuizTreasury, editQuizTreasury, closeQuizTreasury } from "@/lib/quizzes/service";

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
    const treasury = await fundQuizTreasury(auth.user.sub, quizId, body.amount, body.maxClaimants);
    return NextResponse.json({ success: true, data: treasury, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const PATCH = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pollQuizWrite);
    const quizId = await getQuizIdBySlug(params.slug);
    if (!quizId) throw notFound("Quiz not found");
    const body = await validateBody(req, fundSchema);
    const treasury = await editQuizTreasury(auth.user.sub, quizId, body.amount, body.maxClaimants);
    return NextResponse.json({ success: true, data: treasury, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pollQuizWrite);
    const quizId = await getQuizIdBySlug(params.slug);
    if (!quizId) throw notFound("Quiz not found");
    const treasury = await closeQuizTreasury(auth.user.sub, quizId);
    return NextResponse.json({ success: true, data: treasury, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
