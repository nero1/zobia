"use client";

/**
 * app/(app)/blogs/dashboard/stats/page.tsx
 *
 * Creator stats — depth gated by plan (free: totals only; plus: + per-post
 * breakdown; pro/max: + 90-day daily drill-down and CSV export).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

interface Totals {
  post_count: number;
  total_views: number;
  total_likes: number;
  total_comments: number;
  total_unlocks: number;
  total_earnings_kobo: string;
}

interface PostStatRow {
  id: string;
  title: string;
  slug: string;
  type: string;
  status: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  unlock_count: number;
  unlock_credits: number;
}

function formatNaira(kobo: string): string {
  const n = parseInt(kobo, 10) || 0;
  return `₦${(n / 100).toLocaleString()}`;
}

export default function BlogStatsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [blogSlug, setBlogSlug] = useState<string | null>(null);
  const [tier, setTier] = useState<string>("basic");
  const [totals, setTotals] = useState<Totals | null>(null);
  const [postBreakdown, setPostBreakdown] = useState<PostStatRow[] | null>(null);
  const [canExport, setCanExport] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const meRes = await fetch("/api/blogs/me", { credentials: "include" });
      const meJson = await meRes.json().catch(() => null);
      const blog = meJson?.data?.blog;
      if (!blog) { router.replace("/blogs/new"); return; }
      setBlogSlug(blog.slug);

      const res = await fetch(`/api/blogs/${blog.slug}/stats`, { credentials: "include" });
      const json = await res.json().catch(() => null);
      const data = json?.data;
      setTier(data?.tier ?? "basic");
      setTotals(data?.totals ?? null);
      setPostBreakdown(data?.postBreakdown ?? null);
      setCanExport(!!data?.canExport);
      setLoading(false);
    })();
  }, [router]);

  if (loading) return <div className="mx-auto max-w-3xl px-4 py-8 text-muted-foreground">{t("blogs.loading", "Loading…")}</div>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t("blogs.dashboard.stats", "Stats")}</h1>
        {canExport && blogSlug && (
          <a href={`/api/blogs/${blogSlug}/stats/export`} className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent">
            {t("blogs.stats.export", "⬇ Export CSV")}
          </a>
        )}
      </div>

      {totals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-6">
          {[
            { label: t("blogs.stats.posts", "Posts"), value: totals.post_count },
            { label: t("blogs.stats.views", "Views"), value: totals.total_views },
            { label: t("blogs.stats.likes", "Likes"), value: totals.total_likes },
            { label: t("blogs.stats.comments", "Comments"), value: totals.total_comments },
            { label: t("blogs.stats.unlocks", "Paywall unlocks"), value: totals.total_unlocks },
            { label: t("blogs.stats.earnings", "Earnings"), value: formatNaira(totals.total_earnings_kobo) },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-card p-3">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-xl font-bold text-foreground">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {tier === "basic" && (
        <p className="text-sm text-muted-foreground mb-4">
          {t("blogs.stats.upgradeHint", "Upgrade your plan for a per-post breakdown, daily drill-down, and CSV export.")}
        </p>
      )}

      {postBreakdown && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-muted-foreground">
                <th className="px-3 py-2">{t("blogs.stats.title", "Title")}</th>
                <th className="px-3 py-2">{t("blogs.stats.views", "Views")}</th>
                <th className="px-3 py-2">{t("blogs.stats.likes", "Likes")}</th>
                <th className="px-3 py-2">{t("blogs.stats.comments", "Comments")}</th>
                <th className="px-3 py-2">{t("blogs.stats.unlocks", "Unlocks")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {postBreakdown.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 max-w-[200px] truncate text-foreground">{p.title}</td>
                  <td className="px-3 py-2 tabular-nums">{p.view_count}</td>
                  <td className="px-3 py-2 tabular-nums">{p.like_count}</td>
                  <td className="px-3 py-2 tabular-nums">{p.comment_count}</td>
                  <td className="px-3 py-2 tabular-nums">{p.unlock_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
