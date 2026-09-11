/**
 * apps/android/src/components/tweets/TweetCard.tsx
 *
 * Mirrors apps/web/components/tweets/TweetCard.tsx.
 */

import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { UserBadgeRow } from '@/components/shared/UserBadges';
import { VideoEmbed } from './VideoEmbed';
import { type Tweet, timeAgo } from './types';

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
  isOwnProfile?: boolean;
}) {
  const { t } = useTranslation();
  const [showQuoteBox, setShowQuoteBox] = useState(false);
  const [quoteDraft, setQuoteDraft] = useState('');

  return (
    <article className="bg-white border-b border-neutral-100 p-4">
      {tweet.retweetedByUsername && (
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-neutral-500">
          <span aria-hidden="true">🔁</span>
          {t('tweets.retweetedBy', { username: tweet.retweetedByUsername })}
        </div>
      )}
      {tweet.retweetQuoteContent && (
        <p className="mb-2 whitespace-pre-line text-sm text-neutral-700">{tweet.retweetQuoteContent}</p>
      )}
      {tweet.isPinned && (
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-neutral-500">
          <span aria-hidden="true">📌</span>
          {t('tweets.pinned')}
        </div>
      )}

      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-lg">
          {tweet.authorAvatarEmoji}
        </div>
        <div className="min-w-0 flex-1">
          <Link to="/profile/$username" params={{ username: tweet.authorUsername }} className="inline-flex items-center gap-1 font-semibold text-neutral-900 text-sm">
            <span>@{tweet.authorUsername}</span>
            <UserBadgeRow totalXp={tweet.authorXpTotal} prestige={tweet.authorPrestigeCount} verified={tweet.authorIsVerified} />
          </Link>
          <Link to="/tweets/$tweetId" params={{ tweetId: tweet.id }} className="text-neutral-400 text-xs">
            {tweet.parentTweetId ? `${t('tweets.reply')} · ` : ''}
            {timeAgo(tweet.createdAt)} ago
          </Link>
        </div>
        {isOwnProfile && (
          <div className="flex shrink-0 items-center gap-1">
            {tweet.isPinned
              ? onUnpin && (
                  <button onClick={() => onUnpin(tweet.id)} className="rounded-lg px-2 py-1 text-xs font-semibold text-neutral-500">
                    {t('tweets.unpin')}
                  </button>
                )
              : onPin && (
                  <button onClick={() => onPin(tweet.id)} className="rounded-lg px-2 py-1 text-xs font-semibold text-neutral-500">
                    {t('tweets.pin')}
                  </button>
                )}
            {onDelete && (
              <button onClick={() => onDelete(tweet.id)} className="rounded-lg px-2 py-1 text-xs font-semibold text-danger-600">
                {t('tweets.delete')}
              </button>
            )}
          </div>
        )}
      </div>

      {tweet.content && <p className="text-neutral-800 text-sm leading-relaxed whitespace-pre-line">{tweet.content}</p>}

      {tweet.imageUrl && (
        <div className="mt-3 max-h-[420px] overflow-hidden rounded-xl border border-neutral-200">
          <img src={tweet.imageUrl} alt="Tweet image" className="w-full object-cover" loading="lazy" decoding="async" />
        </div>
      )}

      {tweet.videoProvider && tweet.videoUrl && tweet.videoEmbedId && (
        <VideoEmbed provider={tweet.videoProvider} videoUrl={tweet.videoUrl} videoEmbedId={tweet.videoEmbedId} />
      )}

      <div className="mt-2 flex items-center gap-2">
        <Link
          to="/tweets/$tweetId"
          params={{ tweetId: tweet.id }}
          className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600"
        >
          <span>💬</span>
          <span>{tweet.repliesCount}</span>
        </Link>

        {onToggleRetweet && (
          <div className="relative">
            <button
              onClick={() => {
                if (tweet.retweeted) onToggleRetweet(tweet.id, true);
                else setShowQuoteBox((v) => !v);
              }}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                tweet.retweeted ? 'border-green-300 bg-green-50 text-green-600' : 'border-neutral-200 text-neutral-600'
              }`}
            >
              <span>🔁</span>
              <span>{tweet.retweetsCount}</span>
            </button>
            {showQuoteBox && (
              <div className="absolute bottom-full left-0 z-20 mb-1 w-64 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg">
                <button
                  onClick={() => {
                    onToggleRetweet(tweet.id, false);
                    setShowQuoteBox(false);
                  }}
                  className="mb-1.5 w-full rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-neutral-700"
                >
                  🔁 {t('tweets.retweet')}
                </button>
                <textarea
                  value={quoteDraft}
                  onChange={(e) => setQuoteDraft(e.target.value)}
                  placeholder={t('tweets.addComment')}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs focus:outline-none"
                />
                <button
                  onClick={() => {
                    onToggleRetweet(tweet.id, false, quoteDraft.trim());
                    setShowQuoteBox(false);
                    setQuoteDraft('');
                  }}
                  disabled={!quoteDraft.trim()}
                  className="mt-1.5 w-full rounded-lg bg-primary-600 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {t('tweets.quoteRetweet')}
                </button>
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => onToggleLike(tweet.id, tweet.liked)}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
            tweet.liked ? 'border-red-300 bg-red-50 text-red-600' : 'border-neutral-200 text-neutral-600'
          }`}
        >
          <span>{tweet.liked ? '❤️' : '🤍'}</span>
          <span>{tweet.likesCount}</span>
        </button>
      </div>
    </article>
  );
}
