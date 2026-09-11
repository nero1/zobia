"use client";

/**
 * app/(app)/quizzes/page.tsx
 *
 * Quizzes — discovery page. Tabs: New / Popular / Mine. Mirrors
 * app/(app)/polls/page.tsx exactly, swapping voterCount for attemptCount.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { useFeatureFlags } from "@/lib/hooks/useFeatureFlags";
import { NotFoundGate } from "@/components/shared/NotFoundGate";

type Tab = "new" | "popular" | "mine";

interface QuizSummary {
  id: string;
  slug: string;
  title: string;
  attemptCount: number;
  createdAt: string;
  creatorUsername: string | null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function QuizCard({ q }: { q: QuizSummary }) {
  const { t } = useTranslation();
  return (
    <Link
      href={`/quiz/${q.slug}`}
      className="block rounded-xl border border-neutral-200 bg-white p-4 shadow-card transition-colors hover:border-primary-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-primary-700"
    >
      <h3 className="line-clamp-2 text-sm font-semibold text-neutral-900 dark:text-neutral-50">📝 {q.title}</h3>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span>@{q.creatorUsername ?? "unknown"}</span>
        <span>·</span>
        <span>{timeAgo(q.createdAt)}</span>
        <span>·</span>
        <span>{q.attemptCount} {q.attemptCount === 1 ? t("quizzes.list.attempt", "attempt") : t("quizzes.list.attempts", "attempts")}</span>
      </div>
    </Link>
  );
}

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 h-4 w-2/3 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-3 w-1/2 rounded bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

export default function QuizzesPage() {
  const { t } = useTranslation();
  const flags = useFeatureFlags();
  const [tab, setTab] = useState<Tab>("new");
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const user = json?.user ?? json;
        setIsAdmin(!!user?.is_admin);
      })
      .catch(() => {});
  }, []);

  const fetchQuizzes = useCallback(async (nextTab: Tab, append = false, afterCursor: string | null = null) => {
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ tab: nextTab, limit: "20" });
      if (afterCursor) params.set("cursor", afterCursor);
      const res = await fetch(`/api/quizzes?${params.toString()}`, { credentials: "include" });
      if (res.status === 401) { window.location.href = "/auth/login"; return; }
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        if (json?.error?.code === "FEATURE_DISABLED") {
          setFeatureDisabled(true);
          return;
        }
        throw new Error(json?.error?.message ?? "Failed to load quizzes");
      }
      setFeatureDisabled(false);
      const data = json.data as { quizzes: QuizSummary[]; nextCursor: string | null };
      setQuizzes((prev) => (append ? [...prev, ...data.quizzes] : data.quizzes));
      setCursor(data.nextCursor);
      setHasMore(!!data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? translateApiError(t, null, e.message) : "Something went wrong");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [t]);

  useEffect(() => {
    setCursor(null);
    void fetchQuizzes(tab, false, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "new", label: t("quizzes.tabs.new", "New"), icon: "🆕" },
    { key: "popular", label: t("quizzes.tabs.popular", "Popular"), icon: "🔥" },
    { key: "mine", label: t("quizzes.tabs.mine", "Mine"), icon: "👤" },
  ];

  return (
    <NotFoundGate enabled={flags.quizzes ?? true} isAdmin={isAdmin} featureLabel={t("quizzes.title", "Quizzes")}>
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("quizzes.title", "Quizzes")}</h1>
          <Link href="/quizzes/new" className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
            {t("quizzes.createCta", "Create Quiz")}
          </Link>
        </div>

        <div className="mb-4 flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50">
          {tabs.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors sm:text-sm ${tab === key ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-900 dark:text-neutral-50" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}
            >
              <span className="mr-1">{icon}</span>{label}
            </button>
          ))}
        </div>

        {featureDisabled ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white py-16 text-center dark:border-neutral-800 dark:bg-neutral-900">
            <span className="text-4xl">📝</span>
            <p className="mt-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              {t("quizzes.disabled", "Quizzes are currently disabled.")}
            </p>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="space-y-3">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} />)
              ) : quizzes.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white py-16 dark:border-neutral-800 dark:bg-neutral-900">
                  <span className="text-4xl">📝</span>
                  <p className="mt-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                    {tab === "mine" ? t("quizzes.empty.mine", "You haven't created any quizzes yet.") : t("quizzes.empty.default", "No quizzes yet — be the first to create one!")}
                  </p>
                </div>
              ) : (
                quizzes.map((q) => <QuizCard key={q.id} q={q} />)
              )}

              {hasMore && !loading && (
                <button
                  onClick={() => void fetchQuizzes(tab, true, cursor)}
                  disabled={loadingMore}
                  className="w-full rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {loadingMore ? t("quizzes.loadingMore", "Loading…") : t("quizzes.loadMore", "Load More")}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </NotFoundGate>
  );
}
