export const dynamic = "force-dynamic";

/**
 * app/api/answers/questions/route.ts
 *
 * GET  /api/answers/questions  — cursor-paginated question list
 *   ?tab=popular|trending|new|favorites&cursor=&limit=
 * POST /api/answers/questions  — ask a question { title, body }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { listQuestions } from "@/lib/forum/repo";
import { createQuestion } from "@/lib/forum/service";

const listQuerySchema = z.object({
  tab: z.enum(["popular", "trending", "new", "favorites"]).default("new"),
  cursor: z.string().optional(),
  limit: z.string().optional().transform((v) => (v ? Math.min(parseInt(v, 10), 50) : 20)),
});

const createQuestionSchema = z.object({
  title: z.string().trim().min(10, "Title must be at least 10 characters").max(200),
  body: z.string().trim().min(20, "Question body must be at least 20 characters").max(5000),
  categoryId: z.string().uuid().optional().nullable(),
});

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const query = validateSearchParams(req.nextUrl.searchParams, listQuerySchema);
    const result = await listQuestions(auth.user.sub, query.tab, query.cursor, query.limit);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.forumWrite);
    const body = await validateBody(req, createQuestionSchema);
    const result = await createQuestion({ userId: auth.user.sub, title: body.title, body: body.body, categoryId: body.categoryId });
    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
