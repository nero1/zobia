export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ai-monitoring/route.ts
 *
 * GET /api/admin/ai-monitoring?feature=vision:
 *
 * Centralized Admin AI Monitoring panel data: the full ai_call_log
 * (lib/ai/monitoring.ts) across every AI-backed feature (report/ad/quest
 * text moderation, ad/KYC image vision classification), aggregate
 * usage/token stats, per-provider circuit breaker state, and a summary of
 * pending human-review escalations across the platform (report AI
 * escalations, ad image escalations, KYC AI escalations) so an admin has
 * one place to see AI activity and jump to the right queue.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAdminAuth, type AdminContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getRecentAiCalls, getAiUsageStats } from "@/lib/ai/monitoring";
import { getProviderCircuitState } from "@/lib/ai/client";
import { CIRCUIT_BREAKER, type AiProviderId } from "@/lib/ai/config";

const PROVIDERS: AiProviderId[] = ["deepseek", "gemini", "groq"];

/** Mirrors app/api/admin/ai-settings/route.ts's toCircuitStatus — derives the admin-facing status label from raw openedAt state. */
function toCircuitStatus(openedAt: number | null): "closed" | "open" | "half-open" {
  if (openedAt === null) return "closed";
  return Date.now() - openedAt >= CIRCUIT_BREAKER.recoveryTimeMs ? "half-open" : "open";
}

export const GET = withAdminAuth(async (req, { auth }: { auth: AdminContext }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { searchParams } = new URL(req.url);
    const feature = searchParams.get("feature") ?? undefined;
    const limit = Math.min(500, parseInt(searchParams.get("limit") ?? "150", 10) || 150);

    const [calls, usageStats, circuitEntries, pendingCounts] = await Promise.all([
      getRecentAiCalls(limit, feature),
      getAiUsageStats(),
      Promise.all(PROVIDERS.map(async (p) => [p, await getProviderCircuitState(p)] as const)),
      db.query<{ report_escalations: string; ad_escalations: string; kyc_escalations: string }>(
        `SELECT
           (SELECT COUNT(*) FROM moderation_reports WHERE pipeline_status = 'manual_queue' AND ai_confidence IS NOT NULL) AS report_escalations,
           (SELECT COUNT(*) FROM ad_ai_escalations WHERE status = 'pending') AS ad_escalations,
           (SELECT COUNT(*) FROM kyc_submissions WHERE ai_escalated = true AND status = 'manual_review') AS kyc_escalations`
      ),
    ]);

    const circuits = Object.fromEntries(
      circuitEntries.map(([id, state]) => [id, { ...state, status: toCircuitStatus(state.openedAt) }])
    );
    const pending = pendingCounts.rows[0] ?? { report_escalations: "0", ad_escalations: "0", kyc_escalations: "0" };

    return NextResponse.json({
      success: true,
      data: {
        calls,
        usageStats,
        circuits,
        pendingEscalations: {
          reports: parseInt(pending.report_escalations, 10),
          adImages: parseInt(pending.ad_escalations, 10),
          kyc: parseInt(pending.kyc_escalations, 10),
        },
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
