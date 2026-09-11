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
import { mapTweet, type TweetRow } from './types';

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

  const handleToggleRetweet = (tweetId: string, retweeted: boolean, quoteContent?: string) => {
    qc.setQueryData<typeof tweets>(['tweets', 'profile', authorId], (prev) =>
      prev?.map((tw) => (tw.id === tweetId ? { ...tw, retweeted: !retweeted, retweetsCount: tw.retweetsCount + (retweeted ? -1 : 1) } : tw))
    );
    if (retweeted) void apiClient.delete(`/tweets/${tweetId}/retweet`);
    else void apiClient.post(`/tweets/${tweetId}/retweet`, quoteContent ? { quoteContent } : {});
  };

  return (
    <div className="px-6 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-neutral-900 text-sm">{t('tweets.title')}</h3>
        <Link to="/tweets" className="text-xs font-semibold text-primary-600">
          {t('tweets.viewAll')}
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
