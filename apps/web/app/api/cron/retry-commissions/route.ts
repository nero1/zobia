export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/cron/retry-commissions
 *
 * Retries failed referral commissions from the failed_commissions DLQ table.
 * Protected by CRON_SECRET via Authorization: Bearer header.
 * Should be scheduled daily (e.g. 06:00 UTC) via vercel.json or external scheduler.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateCronSecret } from "@/lib/cron/auth";
import { retryFailedCommissions } from "@/lib/referrals/commissions";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const result = await retryFailedCommissions();
    logger.info(result, "[cron/retry-commissions] Run complete");
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    logger.error({ err }, "[cron/retry-commissions] Unhandled error");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
