export const dynamic = "force-dynamic";

/**
 * app/api/polls/route.ts
 *
 * GET  /api/polls  — cursor-paginated poll list ?tab=new|popular|mine&cursor=&limit=
 * POST /api/polls  — create a poll { title, description?, options, allowMultiple?, closesAt? }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { listPolls, createPoll } from "@/lib/polls/service";
import { db } from "@/lib/db";
import { triggerActivityQuestProgress } from "@/lib/quests/questEngine";

const listQuerySchema = z.object({
  tab: z.enum(["new", "popular", "mine"]).default("new"),
  cursor: z.string().optional(),
  limit: z.string().optional().transform((v) => (v ? Math.min(parseInt(v, 10), 50) : 20)),
});

const createPollSchema = z.object({
  title: z.string().trim().min(5, "Title must be at least 5 characters").max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(10),
  allowMultiple: z.boolean().optional(),
  closesAt: z.string().datetime().optional().nullable(),
});

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const query = validateSearchParams(req.nextUrl.searchParams, listQuerySchema);
    const result = await listPolls(query.tab, query.cursor, query.limit, auth.user.sub);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pollQuizWrite);
    const body = await validateBody(req, createPollSchema);
    const result = await createPoll({ userId: auth.user.sub, ...body });
    void triggerActivityQuestProgress(auth.user.sub, "poll_create", db);
    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
