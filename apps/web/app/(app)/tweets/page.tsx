"use client";

/**
 * app/(app)/tweets/page.tsx
 *
 * Tweets feed — four tabs: For You (query-time "hot" ranking), Friends,
 * Following, Mentions. Cursor-paginated ("Load more"), same hand-rolled
 * convention as the Moments feed (app/(app)/moments/page.tsx).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { TweetCard } from "@/components/tweets/TweetCard";
import { type Tweet, mapTweetRow } from "@/components/tweets/types";

type TabKey = "foryou" | "friends" | "following" | "mentions";
const TABS: TabKey[] = ["foryou", "friends", "following", "mentions"];

function TweetSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-neutral-200 dark:bg-neutral-700" />
        <div className="space-y-1.5">
          <div className="h-3.5 w-28 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-3 w-16 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-4 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-4 w-4/5 rounded bg-neutral-200 dark:bg-neutral-700" />
      </div>
    </div>
  );
}

export default function TweetsPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const searchParams = useSearchParams();
  const authorIdFilter = searchParams.get("authorId");

  const [tab, setTab] = useState<TabKey>("foryou");
  const [tweets, setTweets] = useState<Tweet[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (cursorParam: string | null) => {
      const params = new URLSearchParams();
      if (authorIdFilter) params.set("authorId", authorIdFilter);
      else params.set("tab", tab);
      if (cursorParam) params.set("cursor", cursorParam);
      const res = await fetch(`/api/tweets?${params.toString()}`, { credentials: "include" });
      if (res.status === 401) {
        window.location.href = "/auth/login";
        return null;
      }
      if (!res.ok) throw new Error("Failed to load tweets");
      const json = (await res.json()) as { data?: { tweets?: Array<Record<string, unknown>>; nextCursor?: string | null } };
      return {
        rows: (json.data?.tweets ?? []).map(mapTweetRow),
        nextCursor: json.data?.nextCursor ?? null,
      };
    },
    [tab, authorIdFilter]
  );

  useEffect(() => {
    setTweets(undefined);
    setCursor(null);
    (async () => {
      try {
        const page = await fetchPage(null);
        if (!page) return;
        setTweets(page.rows);
        setCursor(page.nextCursor);
      } catch (e) {
        setError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message) : "Unknown error");
        setTweets([]);
      }
    })();
  }, [fetchPage]);

  const handleLoadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(cursor);
      if (!page) return;
      setTweets((prev) => [...(prev ?? []), ...page.rows]);
      setCursor(page.nextCursor);
    } catch {
      // Non-fatal — retry via the button
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, fetchPage]);

  const handleToggleLike = useCallback(async (tweetId: string, liked: boolean) => {
    setTweets((prev) =>
      prev?.map((tw) => (tw.id === tweetId ? { ...tw, liked: !liked, likesCount: tw.likesCount + (liked ? -1 : 1) } : tw))
    );
    try {
      await fetch(`/api/tweets/${tweetId}/like`, { method: liked ? "DELETE" : "POST", credentials: "include" });
    } catch {
      // Non-fatal — UI stays optimistic
    }
  }, []);

  const handleToggleRetweet = useCallback(async (tweetId: string, retweeted: boolean, quoteContent?: string) => {
    setTweets((prev) =>
      prev?.map((tw) => (tw.id === tweetId ? { ...tw, retweeted: !retweeted, retweetsCount: tw.retweetsCount + (retweeted ? -1 : 1) } : tw))
    );
    try {
      if (retweeted) {
        await fetch(`/api/tweets/${tweetId}/retweet`, { method: "DELETE", credentials: "include" });
      } else {
        await fetch(`/api/tweets/${tweetId}/retweet`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(quoteContent ? { quoteContent } : {}),
        });
      }
    } catch {
      // Non-fatal — UI stays optimistic
    }
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("tweets.title")}</h1>
          <p className="mt-0.5 text-sm text-neutral-500">{t("tweets.subtitle")}</p>
        </div>
        <Link
          href="/tweets/create"
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {t("tweets.compose")}
        </Link>
      </div>

      {!authorIdFilter && (
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900">
          {TABS.map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                tab === tabKey
                  ? "bg-blue-600 text-white"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              {t(`tweets.tabs.${tabKey}`)}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {tweets === undefined ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <TweetSkeleton key={i} />
          ))}
        </div>
      ) : tweets.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-12 text-center dark:border-neutral-700 dark:bg-neutral-900">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-200 text-3xl dark:bg-neutral-800">
            🐦
          </div>
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{t(`tweets.empty.${authorIdFilter ? "profile" : tab}`)}</h3>
          <Link
            href="/tweets/create"
            className="mt-4 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {t("tweets.compose")}
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {tweets.map((tw) => (
            <TweetCard key={tw.id} tweet={tw} onToggleLike={handleToggleLike} onToggleRetweet={handleToggleRetweet} />
          ))}
          {cursor && (
            <div className="flex justify-center pt-2">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="rounded-xl border border-neutral-300 px-5 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {loadingMore ? t("tweets.loadingMore") : t("tweets.loadMore")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
