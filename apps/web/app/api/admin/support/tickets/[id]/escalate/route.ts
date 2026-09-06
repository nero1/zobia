export const dynamic = "force-dynamic";

/**
 * app/api/admin/support/tickets/[id]/escalate/route.ts
 *
 * POST — escalate a ticket to another staff member. Enforced escalation
 * path (regular support → senior support/admin; senior support → admin) is
 * implemented in lib/support/service.ts#escalateTicket.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireSupportStaff } from "@/lib/support/staffAuth";
import { escalateTicket } from "@/lib/support/service";

interface Params {
  id: string;
}

const escalateSchema = z.object({
  targetUserId: z.string().uuid(),
});

export const POST = withAuth<Params>(async (req: NextRequest, { auth, params }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    await requireSupportStaff(auth.user.sub);
    const body = await validateBody(req, escalateSchema);
    await escalateTicket(params.id, auth.user.sub, body.targetUserId);
    return NextResponse.json({ success: true, data: { ok: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
