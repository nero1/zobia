export const dynamic = "force-dynamic";

/**
 * app/api/quizzes/route.ts
 *
 * GET  /api/quizzes — cursor-paginated quiz list ?tab=new|popular|mine&cursor=&limit=
 * POST /api/quizzes — create a quiz { title, description?, passingScorePercent?, maxAttemptsPerUser?, questions }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { listQuizzes, createQuiz } from "@/lib/quizzes/service";

const listQuerySchema = z.object({
  tab: z.enum(["new", "popular", "mine"]).default("new"),
  cursor: z.string().optional(),
  limit: z.string().optional().transform((v) => (v ? Math.min(parseInt(v, 10), 50) : 20)),
});

const questionSchema = z.object({
  prompt: z.string().trim().min(1).max(500),
  type: z.enum(["single", "multiple", "true_false"]),
  points: z.number().int().min(1).max(100).optional(),
  options: z.array(z.object({ label: z.string().trim().min(1).max(200), isCorrect: z.boolean() })).min(2).max(8),
});

const createQuizSchema = z.object({
  title: z.string().trim().min(5, "Title must be at least 5 characters").max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  passingScorePercent: z.number().int().min(0).max(100).optional(),
  maxAttemptsPerUser: z.number().int().min(1).max(20).optional(),
  questions: z.array(questionSchema).min(1).max(25),
});

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const query = validateSearchParams(req.nextUrl.searchParams, listQuerySchema);
    const result = await listQuizzes(query.tab, query.cursor, query.limit, auth.user.sub);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pollQuizWrite);
    const body = await validateBody(req, createQuizSchema);
    const result = await createQuiz({ userId: auth.user.sub, ...body });
    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
