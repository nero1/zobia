export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * app/api/cron/games/route.ts
 *
 * Periodic games housekeeping (idempotent):
 *  - Expire stale pending/active challenges and refund any escrow.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { expireChallenges } from "@/lib/games/challenges";
import { validateCronSecret } from "@/lib/cron/auth";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const expired = await expireChallenges();
    return NextResponse.json({ ok: true, expired, timestamp: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
