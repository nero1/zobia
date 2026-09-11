/**
 * apps/android/src/lib/hooks/useTweetLengthPolicy.ts
 *
 * Mirrors apps/web/lib/hooks/useTweetLengthPolicy.ts.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface TweetLengthPolicy {
  defaultMaxLength: number;
  personalMaxLength: number;
  longMaxLengthChars: number;
  isLongFormExempt: boolean;
  longTweetCostCredits: number;
  creditBalance: number;
}

const DEFAULTS: TweetLengthPolicy = {
  defaultMaxLength: 280,
  personalMaxLength: 280,
  longMaxLengthChars: 6000,
  isLongFormExempt: false,
  longTweetCostCredits: 10,
  creditBalance: 0,
};

async function fetchPolicy(): Promise<TweetLengthPolicy> {
  try {
    const { data } = await apiClient.get<Partial<TweetLengthPolicy>>('/tweets/policy');
    return { ...DEFAULTS, ...data };
  } catch {
    return DEFAULTS;
  }
}

export function useTweetLengthPolicy(): TweetLengthPolicy {
  const { data } = useQuery<TweetLengthPolicy>({
    queryKey: ['tweets', 'policy'],
    queryFn: fetchPolicy,
    staleTime: 60_000,
    placeholderData: DEFAULTS,
  });
  return data ?? DEFAULTS;
}
