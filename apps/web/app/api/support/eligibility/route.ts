export const dynamic = "force-dynamic";

/**
 * app/api/support/eligibility/route.ts
 *
 * GET — tells the client whether the caller can open a ticket for free, and
 * if not, what it costs, so the UI can render the right CTA (Feature 1 §2,
 * and reused by the Help Center "Contact a real person" block, Feature 2 §6).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getTicketEligibility } from "@/lib/support/eligibility";
import { loadManifest } from "@/lib/manifest";

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const [eligibility, manifest] = await Promise.all([getTicketEligibility(auth.user.sub), loadManifest()]);
    return NextResponse.json({
      success: true,
      data: {
        ...eligibility,
        // When help_center_ai_free_for_all is on, the Help Center CTA never
        // shows cost messaging even if a plain ticket would normally cost.
        helpCenterFree: manifest.helpCenterSettings.aiFreeForAll,
        supportTicketsEnabled: manifest.features.supportTickets,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
