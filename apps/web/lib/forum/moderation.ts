/**
 * lib/forum/moderation.ts
 *
 * Auto-moderation for Zobia Answers (mini forum / Q&A) submissions.
 *
 * Reuses the existing rules-based filters from lib/moderation/contentFilter
 * (profanity, duplicate-post detection) rather than duplicating them.
 * Velocity/bot-behavior control is handled separately by rate limiting
 * (RATE_LIMITS.forumWrite) at the route layer — see lib/security/rateLimit.ts.
 *
 * @module lib/forum/moderation
 */

import type { DatabaseAdapter } from "@/lib/db/interface";
import { filterProfanity, detectDuplicateMessage, type AutoModerationReason } from "@/lib/moderation/contentFilter";
import { logger } from "@/lib/logger";

export interface ForumAutoModerationInput {
  /** Question title — omit for answers. */
  title?: string;
  body: string;
  authorId: string;
  targetType: "forum_question" | "forum_answer";
}

export interface ForumAutoModerationResult {
  /** Whether the post should be blocked entirely. */
  blocked: boolean;
  reason: AutoModerationReason | null;
  /** Cleaned title (profanity replaced with asterisks); undefined if no title was given. */
  filteredTitle: string | undefined;
  /** Cleaned body (profanity replaced with asterisks). */
  filteredBody: string;
}

/**
 * Run auto-moderation rules against a new forum question or answer.
 *
 * Priority order (matches lib/moderation/contentFilter.applyAutoModeration):
 *  1. Duplicate-post detection (block) — same author, same normalized body
 *     text, within the last 60s.
 *  2. Profanity filter (clean content, never block on profanity alone).
 */
export async function applyForumAutoModeration(
  input: ForumAutoModerationInput,
  db: DatabaseAdapter
): Promise<ForumAutoModerationResult> {
  const { title, body, authorId, targetType } = input;

  try {
    const isDuplicate = await detectDuplicateMessage(
      authorId,
      body,
      60_000,
      db,
      targetType
    );
    if (isDuplicate) {
      return { blocked: true, reason: "duplicate_message", filteredTitle: title, filteredBody: body };
    }
  } catch (err) {
    logger.error({ err, authorId, targetType }, "[forum/moderation] detectDuplicateMessage error");
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
