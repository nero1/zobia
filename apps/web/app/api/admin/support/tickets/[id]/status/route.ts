export const dynamic = "force-dynamic";

/**
 * app/api/admin/support/tickets/[id]/status/route.ts
 *
 * POST — change ticket status (e.g. mark resolved/closed).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireSupportStaff } from "@/lib/support/staffAuth";
import { setTicketStatus } from "@/lib/support/service";

interface Params {
  id: string;
}

const statusSchema = z.object({
  status: z.enum(["open", "pending", "escalated", "resolved", "closed"]),
});

export const POST = withAuth<Params>(async (req: NextRequest, { auth, params }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    await requireSupportStaff(auth.user.sub);
    const body = await validateBody(req, statusSchema);
    await setTicketStatus(params.id, auth.user.sub, body.status);
    return NextResponse.json({ success: true, data: { ok: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
