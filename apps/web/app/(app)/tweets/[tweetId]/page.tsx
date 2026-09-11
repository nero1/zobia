"use client";

/**
 * app/(app)/tweets/[tweetId]/page.tsx
 *
 * Single-tweet deep link view — a stable, shareable URL for one Tweet
 * (`/tweets/<id>`), used as the "posted N ago" link on every TweetCard and
 * as the deep-link target on both web and the Capacitor Android app. Also
 * shows the reply thread (chronological, cursor-paginated) and an inline
 * reply composer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { TweetCard } from "@/components/tweets/TweetCard";
import { type Tweet, mapTweetRow } from "@/components/tweets/types";

export default function TweetDetailPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams();
  const tweetId = params.tweetId as string;

  const [tweet, setTweet] = useState<Tweet | null | undefined>(undefined);
  const [ownUserId, setOwnUserId] = useState<string | null>(null);
  const [replies, setReplies] = useState<Tweet[]>([]);
  const [repliesCursor, setRepliesCursor] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setOwnUserId((json?.user ?? json)?.id ?? null))
      .catch(() => {});
  }, []);

  const fetchRepliesPage = useCallback(
    async (cursorParam: string | null) => {
      const params = new URLSearchParams({ parentTweetId: tweetId, limit: "20" });
      if (cursorParam) params.set("cursor", cursorParam);
      const res = await fetch(`/api/tweets?${params.toString()}`, { credentials: "include" });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: { tweets?: Array<Record<string, unknown>>; nextCursor?: string | null } };
      return {
        rows: (json.data?.tweets ?? []).map(mapTweetRow),
        nextCursor: json.data?.nextCursor ?? null,
      };
    },
    [tweetId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tweets/${tweetId}`, { credentials: "include" });
        if (res.status === 401) {
          router.push("/auth/login");
          return;
        }
        if (!res.ok) {
          if (!cancelled) setTweet(null);
          return;
        }
        const json = (await res.json()) as { data?: Record<string, unknown> };
        if (!cancelled) setTweet(json.data ? mapTweetRow(json.data) : null);
      } catch {
        if (!cancelled) setTweet(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tweetId, router]);

  useEffect(() => {
    (async () => {
      const page = await fetchRepliesPage(null);
      if (page) {
        setReplies(page.rows);
        setRepliesCursor(page.nextCursor);
      }
    })();
  }, [fetchRepliesPage]);

  const handleLoadMoreReplies = useCallback(async () => {
    if (!repliesCursor) return;
    const page = await fetchRepliesPage(repliesCursor);
    if (page) {
      setReplies((prev) => [...prev, ...page.rows]);
      setRepliesCursor(page.nextCursor);
    }
  }, [repliesCursor, fetchRepliesPage]);

  const handleToggleLike = useCallback(async (id: string, liked: boolean) => {
    const patch = (list: Tweet[]) =>
      list.map((tw) => (tw.id === id ? { ...tw, liked: !liked, likesCount: tw.likesCount + (liked ? -1 : 1) } : tw));
    setTweet((prev) => (prev && prev.id === id ? patch([prev])[0] : prev));
    setReplies((prev) => patch(prev));
    try {
      await fetch(`/api/tweets/${id}/like`, { method: liked ? "DELETE" : "POST", credentials: "include" });
    } catch {
      // Non-fatal
    }
  }, []);

  const handleToggleRetweet = useCallback(async (id: string, retweeted: boolean, quoteContent?: string) => {
    const patch = (list: Tweet[]) =>
      list.map((tw) => (tw.id === id ? { ...tw, retweeted: !retweeted, retweetsCount: tw.retweetsCount + (retweeted ? -1 : 1) } : tw));
    setTweet((prev) => (prev && prev.id === id ? patch([prev])[0] : prev));
    setReplies((prev) => patch(prev));
    try {
      if (retweeted) {
        await fetch(`/api/tweets/${id}/retweet`, { method: "DELETE", credentials: "include" });
      } else {
        await fetch(`/api/tweets/${id}/retweet`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(quoteContent ? { quoteContent } : {}),
        });
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/tweets/${id}`, { method: "DELETE", credentials: "include" });
      } finally {
        if (id === tweetId) router.push("/tweets");
        else setReplies((prev) => prev.filter((r) => r.id !== id));
      }
    },
    [router, tweetId]
  );

  const handlePin = useCallback(async (id: string) => {
    await fetch(`/api/tweets/${id}/pin`, { method: "POST", credentials: "include" });
    setTweet((prev) => (prev ? { ...prev, isPinned: true } : prev));
  }, []);

  const handleUnpin = useCallback(async (id: string) => {
    await fetch(`/api/tweets/${id}/pin`, { method: "DELETE", credentials: "include" });
    setTweet((prev) => (prev ? { ...prev, isPinned: false } : prev));
  }, []);

  async function handleSubmitReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyDraft.trim()) return;
    setReplySubmitting(true);
    setReplyError(null);
    try {
      const res = await fetch("/api/tweets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: replyDraft.trim(), parent_tweet_id: tweetId }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? "Failed to post reply");
      }
      setReplyDraft("");
      setTweet((prev) => (prev ? { ...prev, repliesCount: prev.repliesCount + 1 } : prev));
      const page = await fetchRepliesPage(null);
      if (page) {
        setReplies(page.rows);
        setRepliesCursor(page.nextCursor);
      }
    } catch (e) {
      setReplyError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setReplySubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <Link href="/tweets" className="inline-flex items-center gap-1 text-sm font-semibold text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        {t("tweets.title")}
      </Link>

      {tweet === undefined && (
        <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="h-24 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      )}

      {tweet === null && (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">
          {t("tweets.notFound")}
        </div>
      )}

      {tweet && (
        <>
          <TweetCard
            tweet={tweet}
            onToggleLike={handleToggleLike}
            onToggleRetweet={handleToggleRetweet}
            onDelete={handleDelete}
            onPin={handlePin}
            onUnpin={handleUnpin}
            isOwnProfile={ownUserId === tweet.authorId}
          />

          {/* Reply composer */}
          <form onSubmit={handleSubmitReply} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
            {replyError && <p className="mb-2 text-xs text-red-600">{replyError}</p>}
            <textarea
              ref={replyInputRef}
              value={replyDraft}
              onChange={(e) => setReplyDraft(e.target.value)}
              placeholder={t("tweets.replyPlaceholder")}
              rows={2}
              className="w-full resize-none rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="submit"
                disabled={!replyDraft.trim() || replySubmitting}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {replySubmitting ? t("tweets.create.posting") : t("tweets.reply")}
              </button>
            </div>
          </form>

          {/* Replies */}
          {replies.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
                {t("tweets.repliesCount", { count: tweet.repliesCount })}
              </h2>
              {replies.map((reply) => (
                <TweetCard
                  key={reply.id}
                  tweet={reply}
                  onToggleLike={handleToggleLike}
                  onToggleRetweet={handleToggleRetweet}
                  onDelete={ownUserId === reply.authorId ? handleDelete : undefined}
                  isOwnProfile={ownUserId === reply.authorId}
                />
              ))}
              {repliesCursor && (
                <div className="flex justify-center pt-2">
                  <button
                    onClick={handleLoadMoreReplies}
                    className="rounded-xl border border-neutral-300 px-5 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    {t("tweets.loadMore")}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
