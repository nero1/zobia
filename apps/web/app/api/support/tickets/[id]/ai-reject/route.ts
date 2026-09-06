export const dynamic = "force-dynamic";

/**
 * app/api/support/tickets/[id]/ai-reject/route.ts
 *
 * POST — "This didn't help, talk to a real person." Routes an AI-triaged
 * ticket into the human staff queue. Owner-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { rejectAiTriage } from "@/lib/support/service";

interface Params {
  id: string;
}

export const POST = withAuth<Params>(async (req: NextRequest, { auth, params }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    await rejectAiTriage(params.id, auth.user.sub);
    return NextResponse.json({ success: true, data: { ok: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
