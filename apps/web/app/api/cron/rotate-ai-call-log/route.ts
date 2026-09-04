export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * app/api/cron/rotate-ai-call-log/route.ts
 *
 * Deletes ai_call_log rows older than 48 hours (lib/ai/monitoring.ts) so
 * the AI monitoring table never grows unbounded.
 *
 * Not registered in vercel.json — the platform is on Vercel Hobby, which
 * only allows daily crons, and this only needs to run once a day or so to
 * keep a 48h window trimmed. Point an external scheduler (cron-job.org,
 * GitHub Actions, etc.) at this route with the CRON_SECRET bearer token —
 * see docs/HOW-IT-WORKS.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateCronSecret } from "@/lib/cron/auth";
import { pruneAiCallLog } from "@/lib/ai/monitoring";
import { logger } from "@/lib/logger";

export const GET = async (req: NextRequest) => {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const pruned = await pruneAiCallLog();
    logger.info({ pruned }, "[cron/rotate-ai-call-log] completed");
    return NextResponse.json({ success: true, pruned });
  } catch (err) {
    logger.error({ err }, "[cron/rotate-ai-call-log] failed");
    return NextResponse.json({ error: "Rotation failed" }, { status: 500 });
  }
};
