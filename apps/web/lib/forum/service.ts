/**
 * lib/forum/service.ts
 *
 * Zobia Answers (mini forum / Q&A) — eligibility, creation, voting,
 * favoriting and best-answer pipeline.
 *
 * Mirrors lib/moments/service.ts: feature flag → eligibility → level gate →
 * (optional) charge → atomic insert. XP/credit rewards are awarded
 * best-effort AFTER the write transaction commits (via safeAwardXPFireAndForget
 * and a capped creditCoins call) so a reward-award failure never rolls back
 * or blocks the user's post/vote.
 *
 * @module lib/forum/service
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
import { loadManifest, requireFeatureEnabled, type ZobiaManifest } from "@/lib/manifest";
import { getRankForXP } from "@/lib/xp/engine";
import { safeAwardXPFireAndForget } from "@/lib/xp/safeAwardXP";
import { debitCoins, creditCoins } from "@/lib/economy/coins";
import { applyForumAutoModeration } from "@/lib/forum/moderation";
import { ApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { logger } from "@/lib/logger";

export type ForumTargetType = "question" | "answer";
export const MAX_ANSWER_DEPTH = 10;

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * Checks is_admin/is_moderator fresh from the DATABASE — never trusts the
 * JWT claim alone, matching withAdminAuth's convention elsewhere in the API
 * layer. Used to authorize moderator-only forum actions (remove content,
 * lock questions, mark best answer on someone else's question).
 */
export async function isUserModeratorOrAdmin(userId: string): Promise<boolean> {
  const { rows } = await db.query<{ is_admin: boolean; is_moderator: boolean }>(
    `SELECT is_admin, is_moderator FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  return !!(row?.is_admin || row?.is_moderator);
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export interface ForumEligibility {
  rankNumber: number;
  creditBalance: number;
  config: ZobiaManifest["forum"];
}

export async function getForumEligibility(userId: string): Promise<ForumEligibility> {
  const [manifest, userRows] = await Promise.all([
    loadManifest(),
    db.query<{ xp_total: number; coin_balance: number }>(
      `SELECT COALESCE(xp_total, 0) AS xp_total, COALESCE(coin_balance, 0) AS coin_balance
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    ),
  ]);
  const row = userRows.rows[0];
  if (!row) throw forbidden("User account not found");
  return {
    rankNumber: getRankForXP(row.xp_total).rankNumber,
    creditBalance: row.coin_balance,
    config: manifest.forum,
  };
}

/** Throws a 403 if the user's level is below the configured post threshold. */
export function assertCanPost(eligibility: ForumEligibility): void {
  if (eligibility.rankNumber < eligibility.config.minLevelToPost) {
    throw forbidden(
      `You must reach Level ${eligibility.config.minLevelToPost} to post a question. Your current level is ${eligibility.rankNumber}.`,
      "FORUM_LEVEL_TOO_LOW",
      { minLevel: eligibility.config.minLevelToPost, currentLevel: eligibility.rankNumber }
    );
  }
}

/**
 * Checks whether the user can comment. If below the free comment-level
 * threshold, the caller must have opted in to paying the bypass cost
 * (`payBypass`) and have enough credits — otherwise this throws a
 * structured error the client uses to render "reach level N or spend N credits".
 */
export function assertCanComment(eligibility: ForumEligibility, payBypass: boolean): void {
  if (eligibility.rankNumber >= eligibility.config.minLevelToComment) return;

  if (!payBypass) {
    throw new ApiError(
      403,
      "FORUM_COMMENT_LEVEL_TOO_LOW",
      `You must reach Level ${eligibility.config.minLevelToComment} to comment for free, or spend ${eligibility.config.commentBypassCostCredits} Credits.`,
      undefined,
      undefined,
      {
        minLevel: eligibility.config.minLevelToComment,
        currentLevel: eligibility.rankNumber,
        bypassCostCredits: eligibility.config.commentBypassCostCredits,
      }
    );
  }

  if (eligibility.creditBalance < eligibility.config.commentBypassCostCredits) {
    throw new ApiError(
      402,
      "INSUFFICIENT_FORUM_COMMENT_FUNDS",
      `You don't have enough Credits to comment. You need ${eligibility.config.commentBypassCostCredits} Credits.`,
      undefined,
      undefined,
      { bypassCostCredits: eligibility.config.commentBypassCostCredits, creditBalance: eligibility.creditBalance }
    );
  }
}

// ---------------------------------------------------------------------------
// Reward helpers (best-effort, run after the write transaction commits)
// ---------------------------------------------------------------------------

/**
 * Credits a forum reward while respecting the admin-configured daily cap on
 * total forum-sourced credit rewards per user (anti-farming ceiling). Caps
 * the awarded amount to whatever headroom remains; awards nothing once the
 * cap is hit. Never throws — reward failures are logged, not propagated.
 */
async function awardForumCreditsCapped(
  userId: string,
  amount: number,
  type: "forum_question_reward" | "forum_answer_reward" | "forum_upvote_reward" | "forum_best_answer_reward",
  referenceId: string,
  description: string,
  dailyCapCredits: number
): Promise<void> {
  if (amount <= 0) return;
  try {
    const { rows } = await db.query<{ earned: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS earned
       FROM coin_ledger
       WHERE user_id = $1 AND transaction_type LIKE 'forum_%' AND amount > 0
         AND created_at >= NOW() - INTERVAL '24 hours'`,
      [userId]
    );
    const earnedToday = parseInt(rows[0]?.earned ?? "0", 10);
    const headroom = dailyCapCredits - earnedToday;
    if (headroom <= 0) return;
    const capped = Math.min(amount, headroom);
    await creditCoins(userId, capped, type, referenceId, description);
  } catch (err) {
    logger.error({ err, userId, type, amount }, "[forum/service] reward credit award failed");
  }
}

function awardForumRewards(
  userId: string,
  xpAmount: number,
  creditAmount: number,
  xpSource: string,
  creditType: "forum_question_reward" | "forum_answer_reward" | "forum_upvote_reward" | "forum_best_answer_reward",
  referenceId: string,
  description: string,
  dailyCapCredits: number
): void {
  if (xpAmount > 0) {
    safeAwardXPFireAndForget(userId, xpAmount, "knowledge", xpSource, referenceId);
  }
  if (creditAmount > 0) {
    awardForumCreditsCapped(userId, creditAmount, creditType, referenceId, description, dailyCapCredits).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Create question / answer
// ---------------------------------------------------------------------------

export interface CreateQuestionInput {
  userId: string;
  title: string;
  body: string;
}

export interface CreateQuestionResult {
  id: string;
  status: "visible" | "needs_review";
}

export async function createQuestion(input: CreateQuestionInput): Promise<CreateQuestionResult> {
  await requireFeatureEnabled("forum");

  const eligibility = await getForumEligibility(input.userId);
  assertCanPost(eligibility);

  const mod = eligibility.config.autoModerationEnabled
    ? await applyForumAutoModeration(
        { title: input.title, body: input.body, authorId: input.userId, targetType: "forum_question" },
        db
      )
    : { blocked: false, reason: null, filteredTitle: input.title, filteredBody: input.body };

  if (mod.blocked) {
    throw badRequest("This question looks like a duplicate of one you posted recently.", "FORUM_CONTENT_BLOCKED");
  }

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO forum_questions (author_id, title, body, status)
     VALUES ($1, $2, $3, 'visible')
     RETURNING id`,
    [input.userId, mod.filteredTitle ?? input.title, mod.filteredBody]
  );
  const questionId = rows[0].id;

  awardForumRewards(
    input.userId,
    eligibility.config.rewardXpPerQuestion,
    eligibility.config.rewardCreditsPerQuestion,
    "forum_question_posted",
    "forum_question_reward",
    `forum_question_reward:${questionId}`,
    "Posted a question on Zobia Answers",
    eligibility.config.dailyRewardCapCredits
  );

  return { id: questionId, status: "visible" };
}

export interface CreateAnswerInput {
  userId: string;
  questionId: string;
  parentAnswerId?: string | null;
  body: string;
  /** Whether the caller opted in to paying the comment-bypass credit cost. */
  payBypass?: boolean;
}

export interface CreateAnswerResult {
  id: string;
  status: "visible" | "needs_review";
}

export async function createAnswer(input: CreateAnswerInput): Promise<CreateAnswerResult> {
  await requireFeatureEnabled("forum");

  const eligibility = await getForumEligibility(input.userId);
  assertCanComment(eligibility, input.payBypass ?? false);

  const { rows: qRows } = await db.query<{ id: string; is_locked: boolean; status: string }>(
    `SELECT id, is_locked, status FROM forum_questions WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [input.questionId]
  );
  const question = qRows[0];
  if (!question || question.status === "removed") throw notFound("Question not found");
  if (question.is_locked) throw forbidden("This question is locked and no longer accepting answers.", "FORUM_QUESTION_LOCKED");

  let depth = 0;
  if (input.parentAnswerId) {
    const { rows: pRows } = await db.query<{ depth: number; question_id: string }>(
      `SELECT depth, question_id FROM forum_answers WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [input.parentAnswerId]
    );
    const parent = pRows[0];
    if (!parent || parent.question_id !== input.questionId) throw notFound("Parent answer not found");
    depth = Math.min(parent.depth + 1, MAX_ANSWER_DEPTH);
  }

  const mod = eligibility.config.autoModerationEnabled
    ? await applyForumAutoModeration(
        { body: input.body, authorId: input.userId, targetType: "forum_answer" },
        db
      )
    : { blocked: false, reason: null, filteredTitle: undefined, filteredBody: input.body };

  if (mod.blocked) {
    throw badRequest("This answer looks like a duplicate of one you posted recently.", "FORUM_CONTENT_BLOCKED");
  }

  const needsBypassCharge = eligibility.rankNumber < eligibility.config.minLevelToComment;
  const referenceId = `forum_comment_bypass:${input.userId}:${randomUUID()}`;

  const answerId = await db.transaction(async (tx: TransactionClient) => {
    if (needsBypassCharge && eligibility.config.commentBypassCostCredits > 0) {
      await debitCoins(
        input.userId,
        eligibility.config.commentBypassCostCredits,
        "forum_comment_bypass",
        referenceId,
        "Spent Credits to comment on Zobia Answers",
        undefined,
        tx
      );
    }

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO forum_answers (question_id, author_id, parent_answer_id, depth, body, status)
       VALUES ($1, $2, $3, $4, $5, 'visible')
       RETURNING id`,
      [input.questionId, input.userId, input.parentAnswerId ?? null, depth, mod.filteredBody]
    );

    await tx.query(
      `UPDATE forum_questions
       SET answer_count = answer_count + 1, last_activity_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [input.questionId]
    );

    return rows[0].id;
  });

  awardForumRewards(
    input.userId,
    eligibility.config.rewardXpPerAnswer,
    eligibility.config.rewardCreditsPerAnswer,
    "forum_answer_posted",
    "forum_answer_reward",
    `forum_answer_reward:${answerId}`,
    "Posted an answer on Zobia Answers",
    eligibility.config.dailyRewardCapCredits
  );

  return { id: answerId, status: "visible" };
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

const VOTE_TABLE: Record<ForumTargetType, "forum_questions" | "forum_answers"> = {
  question: "forum_questions",
  answer: "forum_answers",
};

export interface CastVoteResult {
  voteScore: number;
  myVote: -1 | 0 | 1;
}

export async function castVote(
  targetType: ForumTargetType,
  targetId: string,
  userId: string,
  value: -1 | 1
): Promise<CastVoteResult> {
  await requireFeatureEnabled("forum");
  const table = VOTE_TABLE[targetType];
  const manifest = await loadManifest();

  const result = await db.transaction(async (tx: TransactionClient) => {
    const { rows: targetRows } = await tx.query<{ id: string; author_id: string; vote_score: number }>(
      `SELECT id, author_id, vote_score FROM ${table} WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [targetId]
    );
    const target = targetRows[0];
    if (!target) throw notFound("Content not found");
    if (target.author_id === userId) {
      throw forbidden("You can't vote on your own post.", "FORUM_SELF_VOTE");
    }

    const { rows: existingRows } = await tx.query<{ value: number }>(
      `SELECT value FROM forum_votes WHERE target_type = $1 AND target_id = $2 AND user_id = $3 FOR UPDATE`,
      [targetType, targetId, userId]
    );
    const existing = existingRows[0]?.value ?? 0;

    let delta: number;
    let myVote: -1 | 0 | 1;

    if (existing === value) {
      // Toggle off — voting the same direction again removes the vote.
      await tx.query(
        `DELETE FROM forum_votes WHERE target_type = $1 AND target_id = $2 AND user_id = $3`,
        [targetType, targetId, userId]
      );
      delta = -existing;
      myVote = 0;
    } else if (existing === 0) {
      await tx.query(
        `INSERT INTO forum_votes (target_type, target_id, user_id, value) VALUES ($1, $2, $3, $4)`,
        [targetType, targetId, userId, value]
      );
      delta = value;
      myVote = value;
    } else {
      await tx.query(
        `UPDATE forum_votes SET value = $4 WHERE target_type = $1 AND target_id = $2 AND user_id = $3`,
        [targetType, targetId, userId, value]
      );
      delta = value - existing;
      myVote = value;
    }

    const { rows: updatedRows } = await tx.query<{ vote_score: number }>(
      `UPDATE ${table} SET vote_score = vote_score + $2, updated_at = NOW() WHERE id = $1 RETURNING vote_score`,
      [targetId, delta]
    );

    return {
      voteScore: updatedRows[0].vote_score,
      myVote,
      authorId: target.author_id,
      becameUpvoted: myVote === 1 && existing !== 1,
    };
  });

  // Best-effort reward to the content author when a net new upvote lands —
  // outside the transaction so a reward failure never blocks the vote.
  if (result.becameUpvoted) {
    awardForumRewards(
      result.authorId,
      manifest.forum.rewardXpPerUpvoteReceived,
      manifest.forum.rewardCreditsPerUpvoteReceived,
      "forum_upvote_received",
      "forum_upvote_reward",
      `forum_upvote_reward:${targetType}:${targetId}:${userId}`,
      "Received an upvote on Zobia Answers",
      manifest.forum.dailyRewardCapCredits
    );
  }

  return { voteScore: result.voteScore, myVote: result.myVote };
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

export async function toggleFavorite(userId: string, questionId: string, next: boolean): Promise<{ favoriteCount: number }> {
  await requireFeatureEnabled("forum");

  return db.transaction(async (tx: TransactionClient) => {
    const { rows: qRows } = await tx.query<{ id: string }>(
      `SELECT id FROM forum_questions WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [questionId]
    );
    if (!qRows[0]) throw notFound("Question not found");

    if (next) {
      const { rowCount } = await tx.query(
        `INSERT INTO forum_favorites (user_id, question_id) VALUES ($1, $2) ON CONFLICT (user_id, question_id) DO NOTHING`,
        [userId, questionId]
      );
      if (rowCount && rowCount > 0) {
        await tx.query(`UPDATE forum_questions SET favorite_count = favorite_count + 1 WHERE id = $1`, [questionId]);
      }
    } else {
      const { rowCount } = await tx.query(
        `DELETE FROM forum_favorites WHERE user_id = $1 AND question_id = $2`,
        [userId, questionId]
      );
      if (rowCount && rowCount > 0) {
        await tx.query(`UPDATE forum_questions SET favorite_count = GREATEST(favorite_count - 1, 0) WHERE id = $1`, [questionId]);
      }
    }

    const { rows } = await tx.query<{ favorite_count: number }>(
      `SELECT favorite_count FROM forum_questions WHERE id = $1`,
      [questionId]
    );
    return { favoriteCount: rows[0].favorite_count };
  });
}

// ---------------------------------------------------------------------------
// Best answer
// ---------------------------------------------------------------------------

export async function markBestAnswer(
  questionId: string,
  answerId: string,
  callerId: string,
  callerIsModerator: boolean
): Promise<void> {
  await requireFeatureEnabled("forum");
  const manifest = await loadManifest();

  const { rows: qRows } = await db.query<{ author_id: string }>(
    `SELECT author_id FROM forum_questions WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [questionId]
  );
  const question = qRows[0];
  if (!question) throw notFound("Question not found");
  if (question.author_id !== callerId && !callerIsModerator) {
    throw forbidden("Only the question author or a moderator can mark the best answer.", "FORUM_NOT_QUESTION_AUTHOR");
  }

  const { rows: aRows } = await db.query<{ id: string; author_id: string }>(
    `SELECT id, author_id FROM forum_answers WHERE id = $1 AND question_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [answerId, questionId]
  );
  const answer = aRows[0];
  if (!answer) throw notFound("Answer not found");

  await db.query(`UPDATE forum_questions SET best_answer_id = $2, updated_at = NOW() WHERE id = $1`, [questionId, answerId]);

  awardForumRewards(
    answer.author_id,
    manifest.forum.rewardXpBestAnswer,
    manifest.forum.rewardCreditsBestAnswer,
    "forum_best_answer_awarded",
    "forum_best_answer_reward",
    `forum_best_answer_reward:${answerId}`,
    "Your answer was marked best on Zobia Answers",
    manifest.forum.dailyRewardCapCredits
  );
}

// ---------------------------------------------------------------------------
// Delete / lock (author or moderator)
// ---------------------------------------------------------------------------

export async function deleteQuestion(questionId: string, callerId: string, callerIsModerator: boolean): Promise<void> {
  const { rows } = await db.query<{ author_id: string }>(
    `SELECT author_id FROM forum_questions WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [questionId]
  );
  const question = rows[0];
  if (!question) throw notFound("Question not found");
  if (question.author_id !== callerId && !callerIsModerator) {
    throw forbidden("You can't delete this question.", "FORUM_NOT_AUTHOR");
  }
  await db.query(
    `UPDATE forum_questions SET status = 'removed', deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [questionId]
  );
}

export async function deleteAnswer(answerId: string, callerId: string, callerIsModerator: boolean): Promise<void> {
  const { rows } = await db.query<{ author_id: string; question_id: string }>(
    `SELECT author_id, question_id FROM forum_answers WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [answerId]
  );
  const answer = rows[0];
  if (!answer) throw notFound("Answer not found");
  if (answer.author_id !== callerId && !callerIsModerator) {
    throw forbidden("You can't delete this answer.", "FORUM_NOT_AUTHOR");
  }
  await db.query(
    `UPDATE forum_answers SET status = 'removed', deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [answerId]
  );
  await db.query(
    `UPDATE forum_questions SET answer_count = GREATEST(answer_count - 1, 0) WHERE id = $1`,
    [answer.question_id]
  );
}

export async function setQuestionLocked(questionId: string, locked: boolean): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE forum_questions SET is_locked = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [questionId, locked]
  );
  if (!rowCount) throw notFound("Question not found");
}
