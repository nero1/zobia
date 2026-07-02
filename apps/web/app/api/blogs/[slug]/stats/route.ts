export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/stats/route.ts
 *
 * GET /api/blogs/<slug>/stats — creator/moderator/admin analytics, depth
 * gated by the blog owner's plan (PRD Blogs §Stats):
 *   free           -> totals only ("very basic stats")
 *   plus           -> totals + per-post breakdown ("basic stats, more detail")
 *   pro / max      -> totals + per-post breakdown + 90-day daily drill-down
 *                     (export available via /stats/export, Pro/Max only)
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug, getBlogStatsTotals, getBlogPostStatsBreakdown, getBlogDailyStats } from "@/lib/blogs/repo";
import { isUserModeratorOrAdmin } from "@/lib/blogs/service";
import { getStatsTier } from "@/lib/blogs/limits";
import { db } from "@/lib/db";

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");

    const isOwner = blog.owner_id === auth.user.sub;
    if (!isOwner && !(await isUserModeratorOrAdmin(auth.user.sub))) {
      throw forbidden("Only the blog owner or a moderator can view stats.");
    }

    const { rows } = await db.query<{ plan: string }>(`SELECT plan FROM users WHERE id = $1 LIMIT 1`, [blog.owner_id]);
    const tier = getStatsTier(rows[0]?.plan ?? "free");

    const totals = await getBlogStatsTotals(blog.id);
    const data: Record<string, unknown> = { tier, totals };

    if (tier === "more" || tier === "detailed" || tier === "detailed_export") {
      data.postBreakdown = await getBlogPostStatsBreakdown(blog.id);
    }
    if (tier === "detailed" || tier === "detailed_export") {
      data.dailyStats = await getBlogDailyStats(blog.id, 90);
    }
    data.canExport = tier === "detailed_export";

    return NextResponse.json({ success: true, data, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
