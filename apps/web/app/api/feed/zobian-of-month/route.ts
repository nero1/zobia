export const dynamic = 'force-dynamic';

/**
 * app/api/feed/zobian-of-month/route.ts
 *
 * GET /api/feed/zobian-of-month — public. Returns the current calendar
 * month's Zobian of the Month pick (auto-computed by /api/cron/feed-refresh
 * from monthly XP gain, unless an admin has overridden it — see
 * app/api/admin/zobian-of-month).
 */

import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/errors";
import { getCurrentZobianOfMonth } from "@/lib/feed/zobianOfMonth";

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const current = await getCurrentZobianOfMonth();
    return NextResponse.json({ success: true, data: { zobianOfMonth: current }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
}
