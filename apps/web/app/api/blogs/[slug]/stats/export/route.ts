export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/stats/export/route.ts
 *
 * GET /api/blogs/<slug>/stats/export — CSV download of the 90-day daily
 * stats drill-down. Pro/Max plans only ("export/download stats" — PRD Blogs §Stats).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug, getBlogDailyStats } from "@/lib/blogs/repo";
import { isUserModeratorOrAdmin } from "@/lib/blogs/service";
import { getStatsTier } from "@/lib/blogs/limits";
import { db } from "@/lib/db";

function toCsv(rows: Awaited<ReturnType<typeof getBlogDailyStats>>): string {
  const header = "date,post_title,views,likes,comments,unlock_count,unlock_credits";
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [r.date, escape(r.post_title), r.views, r.likes, r.comments, r.unlock_count, r.unlock_credits].join(","));
  return [header, ...lines].join("\n");
}

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");

    const isOwner = blog.owner_id === auth.user.sub;
    if (!isOwner && !(await isUserModeratorOrAdmin(auth.user.sub))) {
      throw forbidden("Only the blog owner or a moderator can export stats.");
    }

    const { rows } = await db.query<{ plan: string }>(`SELECT plan FROM users WHERE id = $1 LIMIT 1`, [blog.owner_id]);
    const tier = getStatsTier(rows[0]?.plan ?? "free");
    if (tier !== "detailed_export") {
      throw forbidden("Exporting stats requires the Pro or Max plan.", "BLOG_STATS_EXPORT_REQUIRES_UPGRADE");
    }

    const daily = await getBlogDailyStats(blog.id, 90);
    const csv = toCsv(daily);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${blog.slug}-stats.csv"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
