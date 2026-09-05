export const dynamic = "force-dynamic";

/**
 * app/api/admin/ai-settings/calls/route.ts
 *
 * GET /api/admin/ai-settings/calls — the last N rows of the 48-hour rotating
 * AI call log (lib/ai/monitoring.ts). Powers the "Recent Calls" panel on
 * Admin > AI Settings.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth, type AdminContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getRecentAiCalls } from "@/lib/ai/monitoring";

export const GET = withAdminAuth(
  async (req: NextRequest, _ctx: { params: Record<string, string>; auth: AdminContext }) => {
    try {
      const limit = Math.min(parseInt(new URL(req.url).searchParams.get("limit") ?? "100", 10) || 100, 500);
      const calls = await getRecentAiCalls(limit);
      return NextResponse.json({ success: true, data: { calls }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
