export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * app/api/cron/prune-push-tickets/route.ts
 *
 * TASK-20 (BUG-DB-02): Prune stale push_tickets rows to prevent unbounded table growth.
 *
 * Deletes tickets older than 48 hours whose status is already resolved
 * ('ok', 'error', 'DeviceNotRegistered'). Pending/unknown tickets are left
 * in place so the receipt-poller can still confirm delivery.
 *
 * Schedule: daily (Vercel Cron or external scheduler — add to vercel.json).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateCronSecret } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";

export const GET = async (req: NextRequest) => {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { rowCount } = await db.query(
      `DELETE FROM push_tickets
       WHERE created_at < NOW() - INTERVAL '48 hours'
         AND status IN ('ok', 'error', 'DeviceNotRegistered')`
    );

    logger.info({ pruned: rowCount }, "[cron/prune-push-tickets] completed");
    return NextResponse.json({ success: true, pruned: rowCount });
  } catch (err) {
    logger.error({ err }, "[cron/prune-push-tickets] failed");
    return NextResponse.json({ error: "Prune failed" }, { status: 500 });
  }
};
