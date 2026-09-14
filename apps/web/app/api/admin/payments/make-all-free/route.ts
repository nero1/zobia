export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/payments/make-all-free
 *
 * Danger Zone action: sets every payment context's is_free to true
 * site-wide. Shared by BOTH Danger Zone UI entry points —
 * app/(admin)/gate44/settings/page.tsx and
 * app/(admin)/gate44/payments/page.tsx — do not duplicate this logic, only
 * the button. See the "also appears in" comment at each call site.
 *
 * Requires the client to have shown its own confirmation modal first
 * ("WARNING: This will make all products and services free sitewide.");
 * this endpoint does not re-confirm — it acts immediately.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { writeAuditLog } from "@/lib/audit/auditLog";
import { makeAllPaymentsFree, getAllPaymentContextSettings } from "@/lib/payments/contextSettings";

export const POST = withAdminAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    await makeAllPaymentsFree(auth.user.sub);

    writeAuditLog({
      actorId: auth.user.sub,
      action: "admin_all_payments_made_free",
      targetType: "payment_context_settings",
      targetId: "all",
      metadata: { triggeredBy: auth.user.sub },
    });

    const settings = await getAllPaymentContextSettings();
    return NextResponse.json({ success: true, data: settings, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
