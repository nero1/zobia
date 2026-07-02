"use client";

import { useQuery } from "@tanstack/react-query";

export interface ForumConfig {
  minLevelToPost: number;
  minLevelToComment: number;
  commentBypassCostCredits: number;
  enabled: boolean;
}

const DEFAULTS: ForumConfig = {
  minLevelToPost: 2,
  minLevelToComment: 1,
  commentBypassCostCredits: 1,
  enabled: true,
};

interface ManifestForumResponse {
  features?: { forum?: boolean };
  forum?: { minLevelToPost?: number; minLevelToComment?: number; commentBypassCostCredits?: number };
}

async function fetchForumConfig(): Promise<ForumConfig> {
  try {
    const res = await fetch("/api/manifest");
    if (!res.ok) return DEFAULTS;
    const data = (await res.json()) as ManifestForumResponse;
    return {
      minLevelToPost: data.forum?.minLevelToPost ?? DEFAULTS.minLevelToPost,
      minLevelToComment: data.forum?.minLevelToComment ?? DEFAULTS.minLevelToComment,
      commentBypassCostCredits: data.forum?.commentBypassCostCredits ?? DEFAULTS.commentBypassCostCredits,
      enabled: data.features?.forum ?? DEFAULTS.enabled,
    };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Returns the admin-configured Answers level-gate rules.
 * Rides the same cached /api/manifest fetch used by useCurrency/useMomentsConfig
 * (5 min staleTime) so this never adds an extra Redis round trip of its own.
 */
export function useForumConfig(): ForumConfig {
  const { data } = useQuery<ForumConfig>({
    queryKey: ["manifest", "forum"],
    queryFn: fetchForumConfig,
    staleTime: 5 * 60_000,
    placeholderData: DEFAULTS,
  });
  return data ?? DEFAULTS;
}
