export const dynamic = "force-dynamic";

/**
 * app/api/admin/support/tickets/[id]/assign/route.ts
 *
 * POST — assign (or self-assign) a ticket to a staff member.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireSupportStaff } from "@/lib/support/staffAuth";
import { assignTicket } from "@/lib/support/service";

interface Params {
  id: string;
}

const assignSchema = z.object({
  targetUserId: z.string().uuid(),
});

export const POST = withAuth<Params>(async (req: NextRequest, { auth, params }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    await requireSupportStaff(auth.user.sub);
    const body = await validateBody(req, assignSchema);
    await assignTicket(params.id, auth.user.sub, body.targetUserId);
    return NextResponse.json({ success: true, data: { ok: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
