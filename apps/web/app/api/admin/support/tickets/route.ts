export const dynamic = "force-dynamic";

/**
 * app/api/admin/support/tickets/route.ts
 *
 * GET /api/admin/support/tickets — the staff ticket queue, filterable by
 * status/assignee. Access gated by requireSupportStaff (admin-configurable
 * support_staff_roles allow-list), not a fixed admin/moderator check.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireSupportStaff } from "@/lib/support/staffAuth";
import { listQueue } from "@/lib/support/service";

const querySchema = z.object({
  status: z.enum(["open", "pending", "escalated", "resolved", "closed"]).optional(),
  assignedTo: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.string().optional().transform((v) => (v ? Math.min(parseInt(v, 10), 100) : 50)),
});

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    await requireSupportStaff(auth.user.sub);
    const query = validateSearchParams(req.nextUrl.searchParams, querySchema);
    const tickets = await listQueue(query);
    return NextResponse.json({ success: true, data: tickets, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
