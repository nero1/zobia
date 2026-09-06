export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * app/api/cron/support-tickets/route.ts
 *
 * Periodic support-ticket housekeeping (idempotent):
 *  - Auto-close tickets that have sat 'resolved' for 7+ days with no
 *    further activity.
 *
 * Not wired into the Vercel Hobby daily-slot rotation (see docs/HOW-IT-WORKS.md
 * "CRON Architecture") — run this externally (e.g. cron-jobs.org) on a
 * schedule the product owner chooses; every 6-24 hours is reasonable, since
 * closing a resolved ticket a few hours late has no user-facing impact.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { autoCloseStaleResolvedTickets } from "@/lib/support/service";
import { validateCronSecret } from "@/lib/cron/auth";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const closed = await autoCloseStaleResolvedTickets(7);
    return NextResponse.json({ ok: true, closed, timestamp: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
