/**
 * apps/android/src/components/tweets/ProfileTweets.tsx
 *
 * Mirrors apps/web/components/tweets/ProfileTweets.tsx.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';
import { TweetCard } from './TweetCard';
import { mapTweet, optimisticRetweet, applyRetweetResult, type Tweet, type RetweetResult, type TweetRow } from './types';

export function ProfileTweets({ authorId }: { authorId: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: tweets } = useQuery({
    queryKey: ['tweets', 'profile', authorId],
    queryFn: async () => {
      const { data } = await apiClient.get<{ tweets: TweetRow[] }>(`/tweets?authorId=${authorId}&limit=5`);
      return (data?.tweets ?? []).map(mapTweet);
    },
  });

  if (!tweets || tweets.length === 0) return null;

  const isOwnProfile = user?.id === authorId;

  const handleToggleLike = (tweetId: string, liked: boolean) => {
    qc.setQueryData<typeof tweets>(['tweets', 'profile', authorId], (prev) =>
      prev?.map((tw) => (tw.id === tweetId ? { ...tw, liked: !liked, likesCount: tw.likesCount + (liked ? -1 : 1) } : tw))
    );
    void apiClient[liked ? 'delete' : 'post'](`/tweets/${tweetId}/like`);
  };

  const handleToggleRetweet = async (tweetId: string, retweeted: boolean, quoteContent?: string) => {
    const patch = (fn: (tw: Tweet) => Tweet) =>
      qc.setQueryData<typeof tweets>(['tweets', 'profile', authorId], (prev) => prev?.map((tw) => (tw.id === tweetId ? fn(tw) : tw)));
    patch((tw) => optimisticRetweet(tw, retweeted));
    try {
      const res = retweeted
        ? await apiClient.delete<RetweetResult>(`/tweets/${tweetId}/retweet`)
        : await apiClient.post<RetweetResult>(`/tweets/${tweetId}/retweet`, quoteContent ? { quoteContent } : {});
      const d = res?.data;
      if (d) patch((tw) => applyRetweetResult(tw, d));
    } catch {
      patch((tw) => optimisticRetweet(tw, !retweeted));
    }
  };

  return (
    <div className="px-6 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100 text-sm">{t('tweets.title')}</h3>
        <Link to="/tweets" className="text-xs font-semibold text-primary-600 dark:text-primary-300">
          {t('tweets.viewAll')}
        </Link>
      </div>
      <div className="space-y-3">
        {tweets.map((tw) => (
          <TweetCard key={tw.feedId ?? tw.id} tweet={tw} onToggleLike={handleToggleLike} onToggleRetweet={handleToggleRetweet} isOwnProfile={isOwnProfile} />
        ))}
      </div>
    </div>
  );
}
