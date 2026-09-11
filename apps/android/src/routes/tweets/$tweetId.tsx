/**
 * apps/android/src/routes/tweets/$tweetId.tsx
 *
 * Single-tweet deep link view — mirrors
 * apps/web/app/(app)/tweets/[tweetId]/page.tsx, including the reply thread
 * and inline reply composer. Reachable both from the in-feed timestamp link
 * and as an external deep link (see lib/deeplinks/routes.ts + routes/__root.tsx).
 */

import { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth/store';
import { apiClient } from '@/lib/api/client';
import { TweetCard } from '@/components/tweets/TweetCard';
import { mapTweet, type TweetRow } from '@/components/tweets/types';
import { PUBLIC_PATHS, universalLink } from '@/lib/deeplinks/routes';

function TweetDetailPage() {
  const { t } = useTranslation();
  const { tweetId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [replyDraft, setReplyDraft] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // Shares the public, crawlable /t/<id> web page — not this in-app route —
  // so the recipient (who may not have the app) gets a working, SEO-friendly
  // link. Uses the Web Share API available inside the Capacitor WebView, with
  // a clipboard fallback, matching apps/web/app/(app)/tweets/[tweetId]/page.tsx
  // and apps/android/src/routes/answers/$questionId.tsx's handleShare.
  async function handleShare(): Promise<void> {
    const url = universalLink(PUBLIC_PATHS.tweet(tweetId));
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // no fallback UI available
    }
  }

  const { data: tweet, isLoading } = useQuery({
    queryKey: ['tweets', 'detail', tweetId],
    queryFn: async () => {
      const { data } = await apiClient.get<TweetRow>(`/tweets/${tweetId}`);
      return mapTweet(data);
    },
    retry: false,
  });

  const { data: repliesData, fetchNextPage, hasNextPage } = useInfiniteQuery({
    queryKey: ['tweets', 'replies', tweetId],
    queryFn: async ({ pageParam }: { pageParam?: string }) => {
      const params = new URLSearchParams({ parentTweetId: tweetId, limit: '20' });
      if (pageParam) params.set('cursor', pageParam);
      const { data } = await apiClient.get<{ tweets: TweetRow[]; nextCursor: string | null }>(`/tweets?${params}`);
      return { items: (data?.tweets ?? []).map(mapTweet), nextCursor: data?.nextCursor ?? null };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const replies = repliesData?.pages.flatMap((p) => p.items) ?? [];

  const handleToggleLike = (id: string, liked: boolean) => {
    qc.setQueryData<typeof tweet>(['tweets', 'detail', tweetId], (prev) =>
      prev && prev.id === id ? { ...prev, liked: !liked, likesCount: prev.likesCount + (liked ? -1 : 1) } : prev
    );
    qc.setQueryData<typeof repliesData>(['tweets', 'replies', tweetId], (prev) =>
      prev
        ? {
            ...prev,
            pages: prev.pages.map((page) => ({
              ...page,
              items: page.items.map((r) => (r.id === id ? { ...r, liked: !liked, likesCount: r.likesCount + (liked ? -1 : 1) } : r)),
            })),
          }
        : prev
    );
    void apiClient[liked ? 'delete' : 'post'](`/tweets/${id}/like`);
  };

  const handleToggleRetweet = (id: string, retweeted: boolean, quoteContent?: string) => {
    const patch = (tw: { retweeted: boolean; retweetsCount: number }) => ({
      retweeted: !retweeted,
      retweetsCount: tw.retweetsCount + (retweeted ? -1 : 1),
    });
    qc.setQueryData<typeof tweet>(['tweets', 'detail', tweetId], (prev) => (prev && prev.id === id ? { ...prev, ...patch(prev) } : prev));
    if (retweeted) void apiClient.delete(`/tweets/${id}/retweet`);
    else void apiClient.post(`/tweets/${id}/retweet`, quoteContent ? { quoteContent } : {});
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/tweets/${id}`);
    } finally {
      if (id === tweetId) navigate({ to: '/tweets' });
      else qc.invalidateQueries({ queryKey: ['tweets', 'replies', tweetId] });
    }
  };

  const handlePin = async (id: string) => {
    await apiClient.post(`/tweets/${id}/pin`);
    qc.setQueryData<typeof tweet>(['tweets', 'detail', tweetId], (prev) => (prev ? { ...prev, isPinned: true } : prev));
  };

  const handleUnpin = async (id: string) => {
    await apiClient.delete(`/tweets/${id}/pin`);
    qc.setQueryData<typeof tweet>(['tweets', 'detail', tweetId], (prev) => (prev ? { ...prev, isPinned: false } : prev));
  };

  async function handleSubmitReply() {
    if (!replyDraft.trim()) return;
    setReplySubmitting(true);
    setReplyError(null);
    try {
      await apiClient.post('/tweets', { content: replyDraft.trim(), parent_tweet_id: tweetId });
      setReplyDraft('');
      qc.setQueryData<typeof tweet>(['tweets', 'detail', tweetId], (prev) => (prev ? { ...prev, repliesCount: prev.repliesCount + 1 } : prev));
      qc.invalidateQueries({ queryKey: ['tweets', 'replies', tweetId] });
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : t('error.generic'));
    } finally {
      setReplySubmitting(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      <div className="bg-white border-b border-neutral-100 px-4 py-3 flex items-center justify-between">
        <Link to="/tweets" className="text-sm font-semibold text-neutral-500">
          ← {t('tweets.title')}
        </Link>
        {tweet && (
          <button onClick={() => void handleShare()} className="text-sm font-semibold text-neutral-500">
            {shareCopied ? t('tweets.linkCopied', 'Link copied') : t('tweets.share', 'Share')}
          </button>
        )}
      </div>

      {isLoading && (
        <div className="bg-white p-4 animate-pulse">
          <div className="h-24 w-full rounded bg-neutral-200" />
        </div>
      )}

      {!isLoading && !tweet && <div className="p-8 text-center text-sm text-neutral-500">{t('tweets.notFound')}</div>}

      {tweet && (
        <>
          <TweetCard
            tweet={tweet}
            onToggleLike={handleToggleLike}
            onToggleRetweet={handleToggleRetweet}
            onDelete={handleDelete}
            onPin={handlePin}
            onUnpin={handleUnpin}
            isOwnProfile={user?.id === tweet.authorId}
          />

          <div className="bg-white border-b border-neutral-100 p-4">
            {replyError && <p className="mb-2 text-xs text-danger-600">{replyError}</p>}
            <textarea
              value={replyDraft}
              onChange={(e) => setReplyDraft(e.target.value)}
              placeholder={t('tweets.replyPlaceholder')}
              rows={2}
              className="w-full resize-none rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none"
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => void handleSubmitReply()}
                disabled={!replyDraft.trim() || replySubmitting}
                className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {replySubmitting ? t('tweets.create.posting') : t('tweets.reply')}
              </button>
            </div>
          </div>

          {replies.map((reply) => (
            <TweetCard
              key={reply.id}
              tweet={reply}
              onToggleLike={handleToggleLike}
              onToggleRetweet={handleToggleRetweet}
              onDelete={user?.id === reply.authorId ? handleDelete : undefined}
              isOwnProfile={user?.id === reply.authorId}
            />
          ))}
          {hasNextPage && (
            <div className="flex justify-center py-4">
              <button onClick={() => fetchNextPage()} className="rounded-xl border border-neutral-300 px-5 py-2 text-sm font-semibold text-neutral-700">
                {t('tweets.loadMore')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/tweets/$tweetId')({
  component: TweetDetailPage,
});
