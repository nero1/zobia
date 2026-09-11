"use client";

/**
 * components/tweets/ProfileTweets.tsx
 *
 * Compact Tweets section embedded on a user's profile page — pinned tweet
 * first (if any), then the rest newest-first. Fetches independently of the
 * rest of the profile so a Tweets outage never blocks the profile itself.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { TweetCard } from "./TweetCard";
import { type Tweet, mapTweetRow } from "./types";

export function ProfileTweets({ authorId }: { authorId: string }) {
  const { t } = useTranslation();
  const [tweets, setTweets] = useState<Tweet[] | undefined>(undefined);
  const [ownUserId, setOwnUserId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setOwnUserId((json?.user ?? json)?.id ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tweets?authorId=${encodeURIComponent(authorId)}&limit=5`, { credentials: "include" });
        if (!res.ok) {
          if (!cancelled) setTweets([]);
          return;
        }
        const json = (await res.json()) as { data?: { tweets?: Array<Record<string, unknown>> } };
        if (!cancelled) setTweets((json.data?.tweets ?? []).map(mapTweetRow));
      } catch {
        if (!cancelled) setTweets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authorId]);

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

  if (tweets === undefined || tweets.length === 0) return null;

  const isOwnProfile = ownUserId === authorId;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">{t("tweets.title")}</h2>
        <Link href={`/tweets?authorId=${authorId}`} className="text-xs font-semibold text-blue-600 hover:underline">
          {t("tweets.viewAll")}
        </Link>
      </div>
      <div className="space-y-3">
        {tweets.map((tw) => (
          <TweetCard key={tw.id} tweet={tw} onToggleLike={handleToggleLike} onToggleRetweet={handleToggleRetweet} isOwnProfile={isOwnProfile} />
        ))}
      </div>
    </div>
  );
}
