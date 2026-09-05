"use client";

/**
 * components/blogs/ArticleQuotaNotice.tsx
 *
 * "You have X articles left" nag shown in the dashboard post list and the
 * new-post editor. Backed by GET /api/blogs/<slug>/limits, which wraps
 * lib/blogs/limits.ts's getMaxBlogPosts (admin-configurable via manifest) —
 * this component never hardcodes plan limits itself.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

interface LimitsData {
  plan: string;
  used: number;
  maxPosts: number;
  remaining: number;
  planMaxPosts: { plus: number; pro: number; max: number };
}

export function ArticleQuotaNotice({ blogSlug }: { blogSlug: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<LimitsData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/blogs/${blogSlug}/limits`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (!cancelled) setData(json?.data ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [blogSlug]);

  if (!data) return null;

  const exhausted = data.remaining <= 0;
  const isMaxPlan = data.plan === "max";

  return (
    <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${exhausted ? "border-red-500/40 bg-red-950/10 text-red-300" : "border-border bg-card text-foreground"}`}>
      {exhausted ? (
        <p className="font-medium">
          {t("blogs.quota.exhausted", "You have used up all your available articles ({{max}}). Delete some or upgrade your plan for more articles.", { max: data.maxPosts })}
        </p>
      ) : (
        <p className="font-medium">
          {t("blogs.quota.remaining", "You have {{count}} article(s) left.", { count: data.remaining })}{" "}
          {!isMaxPlan && t("blogs.quota.upgradeHint", "Upgrade your plan for more articles.")}
        </p>
      )}

      {!isMaxPlan && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("blogs.quota.planSummary", "Plus: {{plus}} articles · Pro: {{pro}} articles · Max: {{max}} articles", {
            plus: data.planMaxPosts.plus,
            pro: data.planMaxPosts.pro,
            max: data.planMaxPosts.max,
          })}
        </p>
      )}

      <div className="mt-2 flex gap-2">
        {exhausted && (
          <Link href={`/blogs/dashboard?blog=${encodeURIComponent(blogSlug)}`} className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700">
            {t("blogs.quota.deleteLink", "Manage posts")}
          </Link>
        )}
        {!isMaxPlan && (
          <Link href="/settings/subscription" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
            {t("blogs.quota.upgradeButton", "Upgrade plan")}
          </Link>
        )}
      </div>
    </div>
  );
}
