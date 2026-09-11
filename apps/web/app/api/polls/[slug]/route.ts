export const dynamic = "force-dynamic";

/**
 * app/api/polls/[slug]/route.ts
 *
 * GET    /api/polls/:slug — poll detail (options, vote counts, viewer's vote)
 * PATCH  /api/polls/:slug — creator/moderator: { status: "active"|"closed"|"disabled" }
 * DELETE /api/polls/:slug — creator/moderator: soft delete
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getPollBySlug, recordPollView, assertPollOwnerOrAdmin, setPollStatus, deletePoll } from "@/lib/polls/service";
import { isUserModeratorOrAdmin } from "@/lib/forum/service";

const patchSchema = z.object({
  status: z.enum(["active", "closed", "disabled"]),
});

export const GET = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const poll = await getPollBySlug(params.slug, auth.user.sub);
    if (!poll) throw notFound("Poll not found");
    void recordPollView(poll.id);
    return NextResponse.json({ success: true, data: poll, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const PATCH = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pollQuizWrite);
    const poll = await getPollBySlug(params.slug);
    if (!poll) throw notFound("Poll not found");
    const isMod = await isUserModeratorOrAdmin(auth.user.sub);
    await assertPollOwnerOrAdmin(poll.id, auth.user.sub, isMod);
    const body = await validateBody(req, patchSchema);
    await setPollStatus(poll.id, body.status);
    return NextResponse.json({ success: true, data: { status: body.status }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.pollQuizWrite);
    const poll = await getPollBySlug(params.slug);
    if (!poll) throw notFound("Poll not found");
    const isMod = await isUserModeratorOrAdmin(auth.user.sub);
    await assertPollOwnerOrAdmin(poll.id, auth.user.sub, isMod);
    await deletePoll(poll.id);
    return NextResponse.json({ success: true, data: { id: poll.id }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
