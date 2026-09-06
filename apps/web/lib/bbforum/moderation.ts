/**
 * lib/bbforum/moderation.ts
 *
 * Auto-moderation for the old-school BB-style forum (boards/threads/posts).
 * Mirrors lib/forum/moderation.ts (Answers) — reuses the same rules-based
 * filters from lib/moderation/contentFilter (profanity, duplicate-post
 * detection) rather than duplicating them. Velocity/bot-behavior control is
 * handled separately by rate limiting (RATE_LIMITS.forumWrite) at the route
 * layer — see lib/security/rateLimit.ts.
 *
 * @module lib/bbforum/moderation
 */

import type { DatabaseAdapter } from "@/lib/db/interface";
import { filterProfanity, detectDuplicateMessage, type AutoModerationReason } from "@/lib/moderation/contentFilter";
import { logger } from "@/lib/logger";

export interface BbforumAutoModerationInput {
  /** Thread title — omit for replies. */
  title?: string;
  body: string;
  authorId: string;
  targetType: "bb_thread" | "bb_post";
}

export interface BbforumAutoModerationResult {
  blocked: boolean;
  reason: AutoModerationReason | null;
  filteredTitle: string | undefined;
  filteredBody: string;
}

/**
 * Run auto-moderation rules against a new forum thread or reply.
 *
 * Priority order (matches lib/moderation/contentFilter.applyAutoModeration):
 *  1. Duplicate-post detection (block) — same author, same normalized body
 *     text, within the last 60s.
 *  2. Profanity filter (clean content, never block on profanity alone).
 */
export async function applyBbforumAutoModeration(
  input: BbforumAutoModerationInput,
  db: DatabaseAdapter
): Promise<BbforumAutoModerationResult> {
  const { title, body, authorId, targetType } = input;

  try {
    const isDuplicate = await detectDuplicateMessage(authorId, body, 60_000, db, targetType);
    if (isDuplicate) {
      return { blocked: true, reason: "duplicate_message", filteredTitle: title, filteredBody: body };
    }
  } catch (err) {
    logger.error({ err, authorId, targetType }, "[bbforum/moderation] detectDuplicateMessage error");
  }

  const bodyResult = filterProfanity(body);
  const titleResult = title !== undefined ? filterProfanity(title) : null;
  const foundProfanity = bodyResult.found || (titleResult?.found ?? false);

  return {
    blocked: false,
    reason: foundProfanity ? "profanity" : null,
    filteredTitle: titleResult ? titleResult.filtered : title,
    filteredBody: bodyResult.filtered,
  };
}
