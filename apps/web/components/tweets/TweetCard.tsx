"use client";

/**
 * components/tweets/TweetCard.tsx
 *
 * A single Tweet card — author header, text, optional image, optional video
 * embed, pin badge, retweet attribution banner, and like/reply/retweet
 * actions. Shared by the feed, the single-tweet deep link page, and the
 * profile Tweets section.
 */

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { UserBadgeRow } from "@/components/shared/UserBadges";
import { VideoEmbed } from "./VideoEmbed";
import { type Tweet, timeAgo } from "./types";

export function TweetCard({
  tweet,
  onToggleLike,
  onToggleRetweet,
  onPin,
  onUnpin,
  onDelete,
  isOwnProfile,
}: {
  tweet: Tweet;
  onToggleLike: (tweetId: string, liked: boolean) => void;
  onToggleRetweet?: (tweetId: string, retweeted: boolean, quoteContent?: string) => void;
  onPin?: (tweetId: string) => void;
  onUnpin?: (tweetId: string) => void;
  onDelete?: (tweetId: string) => void;
  /** Shows owner-only pin/unpin/delete controls. */
  isOwnProfile?: boolean;
}) {
  const { t } = useTranslation();
  const [showQuoteBox, setShowQuoteBox] = useState(false);
  const [quoteDraft, setQuoteDraft] = useState("");

  return (
    <article className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      {tweet.retweetedByUsername && (
        <div className="flex items-center gap-1.5 border-b border-neutral-100 px-4 py-1.5 text-xs font-semibold text-neutral-500 dark:border-neutral-800">
          <span aria-hidden="true">🔁</span>
          {t("tweets.retweetedBy", { username: tweet.retweetedByUsername })}
        </div>
      )}
      {tweet.retweetQuoteContent && (
        <div className="whitespace-pre-line border-b border-neutral-100 px-4 py-2 text-sm text-neutral-700 dark:border-neutral-800 dark:text-neutral-300">
          {tweet.retweetQuoteContent}
        </div>
      )}
      {tweet.isPinned && (
        <div className="flex items-center gap-1.5 border-b border-neutral-100 px-4 py-1.5 text-xs font-semibold text-neutral-500 dark:border-neutral-800">
          <span aria-hidden="true">📌</span>
          {t("tweets.pinned")}
        </div>
      )}

      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">
          {tweet.authorAvatarEmoji}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/profile/${tweet.authorId}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-neutral-900 hover:underline dark:text-neutral-100"
          >
            <span>@{tweet.authorUsername}</span>
            <UserBadgeRow totalXp={tweet.authorXpTotal} prestige={tweet.authorPrestigeCount} verified={tweet.authorIsVerified} />
          </Link>
          <Link href={`/tweets/${tweet.id}`} className="block text-xs text-neutral-400 hover:underline">
            {tweet.parentTweetId ? `${t("tweets.reply")} · ` : ""}
            {timeAgo(tweet.createdAt)}
          </Link>
        </div>

        {isOwnProfile && (
          <div className="flex shrink-0 items-center gap-1">
            {tweet.isPinned ? (
              onUnpin && (
                <button
                  onClick={() => onUnpin(tweet.id)}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  {t("tweets.unpin")}
                </button>
              )
            ) : (
              onPin && (
                <button
                  onClick={() => onPin(tweet.id)}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  {t("tweets.pin")}
                </button>
              )
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(tweet.id)}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                {t("tweets.delete")}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="px-4 pb-3">
        {tweet.content && (
          <p className="whitespace-pre-line text-sm text-neutral-800 dark:text-neutral-200">{tweet.content}</p>
        )}

        {tweet.imageUrl && (
          <div className="mt-3 max-h-[420px] overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={tweet.imageUrl}
              alt="Tweet image"
              className="max-h-[420px] w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          </div>
        )}

        {tweet.videoProvider && tweet.videoUrl && tweet.videoEmbedId && (
          <VideoEmbed provider={tweet.videoProvider} videoUrl={tweet.videoUrl} videoEmbedId={tweet.videoEmbedId} />
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
        <Link
          href={`/tweets/${tweet.id}`}
          className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <span>💬</span>
          <span>{tweet.repliesCount.toLocaleString()}</span>
        </Link>

        {onToggleRetweet && (
          <div className="relative">
            <button
              onClick={() => {
                if (tweet.retweeted) onToggleRetweet(tweet.id, true);
                else setShowQuoteBox((v) => !v);
              }}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                tweet.retweeted
                  ? "border-green-300 bg-green-50 text-green-600 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400"
                  : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              <span>🔁</span>
              <span>{tweet.retweetsCount.toLocaleString()}</span>
            </button>
            {showQuoteBox && (
              <div className="absolute bottom-full left-0 z-20 mb-1 w-64 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                <button
                  onClick={() => {
                    onToggleRetweet(tweet.id, false);
                    setShowQuoteBox(false);
                  }}
                  className="mb-1.5 w-full rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  🔁 {t("tweets.retweet")}
                </button>
                <textarea
                  value={quoteDraft}
                  onChange={(e) => setQuoteDraft(e.target.value)}
                  placeholder={t("tweets.addComment")}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800"
                />
                <button
                  onClick={() => {
                    onToggleRetweet(tweet.id, false, quoteDraft.trim());
                    setShowQuoteBox(false);
                    setQuoteDraft("");
                  }}
                  disabled={!quoteDraft.trim()}
                  className="mt-1.5 w-full rounded-lg bg-blue-600 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {t("tweets.quoteRetweet")}
                </button>
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => onToggleLike(tweet.id, tweet.liked)}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            tweet.liked
              ? "border-red-300 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400"
              : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
          }`}
        >
          <span>{tweet.liked ? "❤️" : "🤍"}</span>
          <span>{tweet.likesCount.toLocaleString()}</span>
        </button>
      </div>
    </article>
  );
}
