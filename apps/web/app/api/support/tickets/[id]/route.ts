export const dynamic = "force-dynamic";

/**
 * app/api/support/tickets/[id]/route.ts
 *
 * GET  /api/support/tickets/[id]  — ticket + messages, OWNER ONLY (IDOR guard:
 *   getTicketForUser scopes the query to user_id = caller, so another user's
 *   ticket 404s instead of leaking existence).
 * POST /api/support/tickets/[id]  — post a follow-up message, charged per the
 *   admin-configured charging model.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getTicketForUser, postUserMessage } from "@/lib/support/service";

interface Params {
  id: string;
}

const postMessageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

export const GET = withAuth<Params>(async (req: NextRequest, { auth, params }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const result = await getTicketForUser(params.id, auth.user.sub);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<Params>(async (req: NextRequest, { auth, params }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.messageSend);
    const body = await validateBody(req, postMessageSchema);
    const message = await postUserMessage({ ticketId: params.id, userId: auth.user.sub, body: body.body });
    return NextResponse.json({ success: true, data: message, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
