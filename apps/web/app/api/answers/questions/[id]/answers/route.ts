export const dynamic = "force-dynamic";

/**
 * app/api/answers/questions/[id]/answers/route.ts
 *
 * GET  /api/answers/questions/:id/answers — cursor-paginated top-level answers
 *   ?sort=best|new&cursor=&limit=
 * POST /api/answers/questions/:id/answers — post an answer/reply
 *   { body, parentAnswerId?, payBypass? }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { listAnswers } from "@/lib/forum/repo";
import { createAnswer } from "@/lib/forum/service";

const listQuerySchema = z.object({
  sort: z.enum(["best", "new"]).default("best"),
  cursor: z.string().optional(),
  limit: z.string().optional().transform((v) => (v ? Math.min(parseInt(v, 10), 25) : 10)),
});

const createAnswerSchema = z.object({
  body: z.string().trim().min(2, "Answer can't be empty").max(5000),
  parentAnswerId: z.string().uuid().optional().nullable(),
  payBypass: z.boolean().optional(),
});

export const GET = withAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    const { id } = await params;
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const query = validateSearchParams(req.nextUrl.searchParams, listQuerySchema);
    const result = await listAnswers(auth.user.sub, id, query.cursor, query.limit, query.sort);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    const { id } = await params;
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.forumWrite);
    const body = await validateBody(req, createAnswerSchema);
    const result = await createAnswer({
      userId: auth.user.sub,
      questionId: id,
      parentAnswerId: body.parentAnswerId ?? null,
      body: body.body,
      payBypass: body.payBypass,
    });
    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
