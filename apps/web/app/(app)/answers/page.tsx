"use client";

/**
 * app/(app)/answers/page.tsx
 *
 * Answers — mini forum (Q&A) main page.
 * Tabs: Popular / Trending / New / Favorites. Cursor pagination via
 * "Load More" (mirrors app/(app)/rooms/page.tsx's state machine).
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/ui/Avatar";
import { useForumConfig } from "@/lib/hooks/useForumConfig";
import { translateApiError } from "@/lib/i18n/apiErrors";

type Tab = "popular" | "trending" | "new" | "favorites";

interface QuestionSummary {
  id: string;
  title: string;
  body: string;
  author: { id: string; username: string | null; displayName: string | null; avatarEmoji: string | null };
  voteScore: number;
  answerCount: number;
  favoriteCount: number;
  isLocked: boolean;
  bestAnswerId: string | null;
  createdAt: string;
  myVote: -1 | 0 | 1;
  isFavorited: boolean;
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

function QuestionCard({ q, onVote, onFavorite }: {
  q: QuestionSummary;
  onVote: (id: string, value: 1 | -1) => void;
  onFavorite: (id: string, next: boolean) => void;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      {/* Vote column */}
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <button
          aria-label="Upvote"
          onClick={() => onVote(q.id, 1)}
          className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm transition-colors ${q.myVote === 1 ? "bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300" : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
        >
          ▲
        </button>
        <span className="text-sm font-semibold tabular-nums text-neutral-700 dark:text-neutral-300">{q.voteScore}</span>
        <button
          aria-label="Downvote"
          onClick={() => onVote(q.id, -1)}
          className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm transition-colors ${q.myVote === -1 ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
        >
          ▼
        </button>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <Link href={`/answers/${q.id}`} className="block">
          <h3 className="line-clamp-2 text-sm font-semibold text-neutral-900 hover:text-primary-600 dark:text-neutral-50 dark:hover:text-primary-400">
            {q.title}
            {q.isLocked && <span className="ml-1.5 text-xs text-neutral-400">🔒</span>}
            {q.bestAnswerId && <span className="ml-1.5 text-xs text-teal-600 dark:text-teal-400">✓ answered</span>}
          </h3>
          <p className="mt-1 line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">{q.body}</p>
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <Avatar name={q.author.displayName ?? q.author.username ?? "?"} emoji={q.author.avatarEmoji ?? undefined} size="xs" rankTier="none" />
          <span>@{q.author.username ?? "unknown"}</span>
          <span>·</span>
          <span>{timeAgo(q.createdAt)}</span>
          <span>·</span>
          <span>{q.answerCount} {q.answerCount === 1 ? "answer" : "answers"}</span>
          <button
            onClick={() => onFavorite(q.id, !q.isFavorited)}
            aria-label={q.isFavorited ? "Unfavorite" : "Favorite"}
            className={`ml-auto rounded-full px-1.5 py-0.5 transition-colors ${q.isFavorited ? "text-amber-500" : "text-neutral-300 hover:text-amber-400"}`}
          >
            {q.isFavorited ? "★" : "☆"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 h-4 w-2/3 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

export default function AnswersPage() {
  const { t } = useTranslation();
  const forumConfig = useForumConfig();
  const [tab, setTab] = useState<Tab>("new");
  const [questions, setQuestions] = useState<QuestionSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myLevel, setMyLevel] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const user = json?.user ?? json;
        if (user?.rank_level != null) setMyLevel(user.rank_level);
      })
      .catch(() => {});
  }, []);

  const fetchQuestions = useCallback(async (nextTab: Tab, append = false, afterCursor: string | null = null) => {
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ tab: nextTab, limit: "20" });
      if (afterCursor) params.set("cursor", afterCursor);
      const res = await fetch(`/api/answers/questions?${params.toString()}`, { credentials: "include" });
      if (res.status === 401) { window.location.href = "/auth/login"; return; }
      if (!res.ok) throw new Error("Failed to load questions");
      const json = await res.json();
      const data = json.data as { questions: QuestionSummary[]; nextCursor: string | null; hasMore: boolean };
      setQuestions((prev) => (append ? [...prev, ...data.questions] : data.questions));
      setCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (e) {
      setError(e instanceof Error ? translateApiError(t, null, e.message) : "Something went wrong");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [t]);

  useEffect(() => {
    setCursor(null);
    void fetchQuestions(tab, false, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function handleVote(id: string, value: 1 | -1) {
    const target = questions.find((q) => q.id === id);
    if (!target) return;
    const wasVote = target.myVote;
    const nextVote = wasVote === value ? 0 : value;
    const delta = nextVote - wasVote;
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, myVote: nextVote as -1 | 0 | 1, voteScore: q.voteScore + delta } : q)));
    try {
      const res = await fetch(`/api/answers/questions/${id}/vote`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error("vote failed");
      const json = await res.json();
      setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, voteScore: json.data.voteScore, myVote: json.data.myVote } : q)));
    } catch {
      setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, myVote: wasVote, voteScore: q.voteScore - delta } : q)));
    }
  }

  async function handleFavorite(id: string, next: boolean) {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, isFavorited: next, favoriteCount: q.favoriteCount + (next ? 1 : -1) } : q)));
    try {
      const res = await fetch(`/api/answers/questions/${id}/favorite`, {
        method: next ? "POST" : "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("favorite failed");
      if (tab === "favorites" && !next) {
        setQuestions((prev) => prev.filter((q) => q.id !== id));
      }
    } catch {
      setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, isFavorited: !next, favoriteCount: q.favoriteCount + (next ? -1 : 1) } : q)));
    }
  }

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "popular", label: t("answers.tabs.popular", "Popular"), icon: "🔥" },
    { key: "trending", label: t("answers.tabs.trending", "Trending"), icon: "📈" },
    { key: "new", label: t("answers.tabs.new", "New"), icon: "🆕" },
    { key: "favorites", label: t("answers.tabs.favorites", "Favorites"), icon: "★" },
  ];

  const canPost = myLevel === null || myLevel >= forumConfig.minLevelToPost;

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("answers.title", "Answers")}</h1>
        {canPost ? (
          <Link href="/answers/ask" className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
            {t("answers.ask.cta", "Ask a Question")}
          </Link>
        ) : (
          <span
            title={t("answers.ask.levelTooLowTooltip", "Reach Level {{level}} to post", { level: forumConfig.minLevelToPost })}
            className="cursor-not-allowed rounded-xl border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-400 dark:border-neutral-800"
          >
            {t("answers.ask.levelTooLowShort", "Level {{level}}+ to post", { level: forumConfig.minLevelToPost })}
          </span>
        )}
      </div>

      {/* Tabs */}
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

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} />)
        ) : questions.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white py-16 dark:border-neutral-800 dark:bg-neutral-900">
            <span className="text-4xl">❓</span>
            <p className="mt-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              {tab === "favorites" ? t("answers.empty.favorites", "No favorited questions yet.") : t("answers.empty.default", "No questions yet — be the first to ask!")}
            </p>
          </div>
        ) : (
          questions.map((q) => <QuestionCard key={q.id} q={q} onVote={handleVote} onFavorite={handleFavorite} />)
        )}

        {hasMore && !loading && (
          <button
            onClick={() => void fetchQuestions(tab, true, cursor)}
            disabled={loadingMore}
            className="w-full rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {loadingMore ? t("answers.loadingMore", "Loading…") : t("answers.loadMore", "Load More")}
          </button>
        )}
      </div>
    </div>
  );
}
