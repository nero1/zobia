"use client";

import { useQuery } from "@tanstack/react-query";

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
    const res = await fetch("/api/tweets/policy", { credentials: "include" });
    if (!res.ok) return DEFAULTS;
    const json = (await res.json()) as { data?: Partial<TweetLengthPolicy> };
    return { ...DEFAULTS, ...json.data };
  } catch {
    return DEFAULTS;
  }
}

/**
 * The signed-in caller's effective Tweet-length policy (GET /api/tweets/policy)
 * — the composer's character counter and cost notice both key off this.
 */
export function useTweetLengthPolicy(): TweetLengthPolicy {
  const { data } = useQuery<TweetLengthPolicy>({
    queryKey: ["tweets", "policy"],
    queryFn: fetchPolicy,
    staleTime: 60_000,
    placeholderData: DEFAULTS,
  });
  return data ?? DEFAULTS;
}
