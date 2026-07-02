/**
 * apps/android/src/lib/hooks/useForumConfig.ts
 *
 * Mirrors apps/web/lib/hooks/useForumConfig.ts — reads the admin-configured
 * Zobia Answers level-gate rules off the same cached /api/manifest fetch
 * used by useCurrency/useMomentsConfig (no extra Redis round trip).
 */

import { useManifest } from '@/lib/hooks/useManifest';

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

interface ManifestForum {
  minLevelToPost?: number;
  minLevelToComment?: number;
  commentBypassCostCredits?: number;
}

export function useForumConfig(): ForumConfig {
  const manifest = useManifest();
  const forum = manifest?.forum as ManifestForum | undefined;
  const enabled = (manifest?.features as { forum?: boolean } | undefined)?.forum;
  return {
    minLevelToPost: forum?.minLevelToPost ?? DEFAULTS.minLevelToPost,
    minLevelToComment: forum?.minLevelToComment ?? DEFAULTS.minLevelToComment,
    commentBypassCostCredits: forum?.commentBypassCostCredits ?? DEFAULTS.commentBypassCostCredits,
    enabled: enabled ?? DEFAULTS.enabled,
  };
}
