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
  minLevel: number;
  currentLevel: number;
}

const DEFAULTS: TweetLengthPolicy = {
  defaultMaxLength: 280,
  personalMaxLength: 280,
  longMaxLengthChars: 6000,
  isLongFormExempt: false,
  longTweetCostCredits: 10,
  creditBalance: 0,
  minLevel: 1,
  currentLevel: 1,
};

async function fetchPolicy(): Promise<TweetLengthPolicy> {
  try {
    const { data } = await apiClient.get<Partial<TweetLengthPolicy>>('/tweets/policy');
    return { ...DEFAULTS, ...data };
  } catch {
    return DEFAULTS;
  }
}

/**
 * `isLoading` reflects the real network fetch — placeholderData fills
 * `minLevel`/`currentLevel` with permissive defaults, so a caller that
 * gates on eligibility must check `isLoading` first, not just the numbers.
 */
export function useTweetLengthPolicy(): TweetLengthPolicy & { isLoading: boolean } {
  const { data, isLoading } = useQuery<TweetLengthPolicy>({
    queryKey: ['tweets', 'policy'],
    queryFn: fetchPolicy,
    staleTime: 60_000,
    placeholderData: DEFAULTS,
  });
  return { ...(data ?? DEFAULTS), isLoading };
}
