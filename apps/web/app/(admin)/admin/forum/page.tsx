"use client";

/**
 * app/(admin)/admin/forum/page.tsx
 *
 * Answers (mini forum / Q&A) admin dashboard.
 * Accessible to admins and moderators (moderators are scoped to /admin/forum/*
 * only — see middleware.ts FORUM_MOD_PREFIXES).
 */

import { useEffect, useState } from "react";
import Link from "next/link";

interface ForumStats {
  pendingReports: number;
  questionsToday: number;
  answersToday: number;
  topPosters: { username: string | null; questions: string; answers: string }[];
}

function StatCard({ label, value, href }: { label: string; value: number | string; href?: string }) {
  const content = (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export default function AdminForumDashboardPage() {
  const [stats, setStats] = useState<ForumStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/forum/stats", { credentials: "include" })
      .then((r) => {
        if (r.status === 401 || r.status === 403) { window.location.href = "/admin/login"; return null; }
        return r.ok ? r.json() : Promise.reject(new Error("Failed to load stats"));
      })
      .then((json) => { if (json) setStats(json.data); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load stats"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Answers</h1>

      <div className="mb-6 flex flex-wrap gap-2">
        <Link href="/admin/forum/queue" className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900">
          Moderation Queue
        </Link>
        <Link href="/admin/forum/posts" className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
          Manage Posts
        </Link>
        <Link href="/admin/forum/settings" className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
          Settings
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
          ))}
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Pending Reports" value={stats.pendingReports} href="/admin/forum/queue" />
            <StatCard label="Questions Today" value={stats.questionsToday} />
            <StatCard label="Answers Today" value={stats.answersToday} />
          </div>

          <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Top Posters (7 days)</h2>
            {stats.topPosters.length === 0 ? (
              <p className="text-sm text-neutral-500">No activity in the last 7 days.</p>
            ) : (
              <ul className="space-y-1.5">
                {stats.topPosters.map((p, i) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <span className="text-neutral-700 dark:text-neutral-300">@{p.username ?? "unknown"}</span>
                    <span className="text-neutral-500">{p.questions} questions · {p.answers} answers</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
