export const dynamic = "force-dynamic";

/**
 * app/api/admin/support/tickets/[id]/route.ts
 *
 * GET  — ticket + messages for staff (any ticket, not owner-scoped).
 * POST — staff reply (always free — no charging model applies to staff).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireSupportStaff } from "@/lib/support/staffAuth";
import { getTicketForStaff, postStaffMessage } from "@/lib/support/service";

interface Params {
  id: string;
}

const replySchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

export const GET = withAuth<Params>(async (req: NextRequest, { auth, params }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    await requireSupportStaff(auth.user.sub);
    const result = await getTicketForStaff(params.id);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<Params>(async (req: NextRequest, { auth, params }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.messageSend);
    await requireSupportStaff(auth.user.sub);
    const body = await validateBody(req, replySchema);
    const message = await postStaffMessage(params.id, auth.user.sub, body.body);
    return NextResponse.json({ success: true, data: message, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
