/**
 * lib/forum/service.ts
 *
 * Answers (mini forum / Q&A) — eligibility, creation, voting,
 * favoriting and best-answer pipeline.
 *
 * Mirrors lib/moments/service.ts: feature flag → eligibility → level gate →
 * (optional) charge → atomic insert. XP/credit rewards are awarded
 * best-effort AFTER the write transaction commits (via safeAwardXPFireAndForget
 * and a capped creditCoins call) so a reward-award failure never rolls back
 * or blocks the user's post/vote.
 *
 * DRIZZLE MIGRATION NOTE: `debitCoins` (lib/economy/coins.ts) has already
 * been migrated to Drizzle (takes `DbOrTx`), so `createAnswer`'s transaction
 * runs as a Drizzle `orm.transaction()`. `lib/slug.ts` (generateUniqueSlug)
 * is outside this migration's file list and still takes the legacy
 * `Queryable` adapter, but is called here with no client argument (it
 * defaults to the legacy `db` internally), so no raw `db` handle needs to
 * be kept in scope here.
 *
 * @module lib/forum/service
 */

import { randomUUID } from "crypto";
import { getDb, schema } from "@/lib/db/drizzle";
import { and, eq, isNull, sql } from "drizzle-orm";
import { loadManifest, requireFeatureEnabled, type ZobiaManifest } from "@/lib/manifest";
import { getRankForXP } from "@/lib/xp/engine";
import { safeAwardXPFireAndForget } from "@/lib/xp/safeAwardXP";
import { debitCoins, creditCoins } from "@/lib/economy/coins";
import { applyForumAutoModeration } from "@/lib/forum/moderation";
import { generateUniqueSlug } from "@/lib/slug";
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
  const orm = await getDb();
  const rows = await orm
    .select({ isAdmin: schema.users.isAdmin, isModerator: schema.users.isModerator })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
    .limit(1);
  const row = rows[0];
  return !!(row?.isAdmin || row?.isModerator);
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
  const orm = await getDb();
  const [manifest, userRows] = await Promise.all([
    loadManifest(),
    orm
      .select({ xpTotal: schema.users.xpTotal, coinBalance: schema.users.coinBalance })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1),
  ]);
  const row = userRows[0];
  if (!row) throw forbidden("User account not found");
  return {
    rankNumber: getRankForXP(Number(row.xpTotal ?? 0)).rankNumber,
    creditBalance: Number(row.coinBalance ?? 0),
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
    const orm = await getDb();
    const rows = await orm
      .select({ earned: sql<string>`COALESCE(SUM(${schema.coinLedger.amount}), 0)::text` })
      .from(schema.coinLedger)
      .where(
        and(
          eq(schema.coinLedger.userId, userId),
          sql`${schema.coinLedger.transactionType} LIKE 'forum_%'`,
          sql`${schema.coinLedger.amount} > 0`,
          sql`${schema.coinLedger.createdAt} >= NOW() - INTERVAL '24 hours'`
        )
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
  categoryId?: string | null;
}

export interface CreateQuestionResult {
  id: string;
  slug: string;
  status: "visible" | "needs_review";
}

export async function createQuestion(input: CreateQuestionInput): Promise<CreateQuestionResult> {
  await requireFeatureEnabled("forum");

  const eligibility = await getForumEligibility(input.userId);
  assertCanPost(eligibility);

  const orm = await getDb();

  const mod = eligibility.config.autoModerationEnabled
    ? await applyForumAutoModeration(
        { title: input.title, body: input.body, authorId: input.userId, targetType: "forum_question" },
        orm
      )
    : { blocked: false, reason: null, filteredTitle: input.title, filteredBody: input.body };

  if (mod.blocked) {
    throw badRequest("This question looks like a duplicate of one you posted recently.", "FORUM_CONTENT_BLOCKED");
  }

  // A stable id is generated up-front (rather than relying on the DB
  // default) so it can double as the slug's collision fallback, matching
  // the room/game creation convention (generate id -> derive slug -> insert).
  const questionId = randomUUID();
  const finalTitle = mod.filteredTitle ?? input.title;
  const slug = await generateUniqueSlug("forum_question", finalTitle, questionId);

  const categoryId = input.categoryId?.trim() || null;
  if (categoryId) {
    const catRows = await orm.select({ id: schema.forumCategories.id }).from(schema.forumCategories).where(eq(schema.forumCategories.id, categoryId)).limit(1);
    if (!catRows[0]) throw badRequest("Unknown category.", "FORUM_UNKNOWN_CATEGORY");
  }

  await orm.insert(schema.forumQuestions).values({
    id: questionId,
    authorId: input.userId,
    categoryId,
    title: finalTitle,
    slug,
    body: mod.filteredBody,
    status: "visible",
  });

  awardForumRewards(
    input.userId,
    eligibility.config.rewardXpPerQuestion,
    eligibility.config.rewardCreditsPerQuestion,
    "forum_question_posted",
    "forum_question_reward",
    `forum_question_reward:${questionId}`,
    "Posted a question on Answers",
    eligibility.config.dailyRewardCapCredits
  );

  return { id: questionId, slug, status: "visible" };
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

  const orm = await getDb();
  const qRows = await orm
    .select({ id: schema.forumQuestions.id, isLocked: schema.forumQuestions.isLocked, status: schema.forumQuestions.status })
    .from(schema.forumQuestions)
    .where(and(eq(schema.forumQuestions.id, input.questionId), isNull(schema.forumQuestions.deletedAt)))
    .limit(1);
  const question = qRows[0];
  if (!question || question.status === "removed") throw notFound("Question not found");
  if (question.isLocked) throw forbidden("This question is locked and no longer accepting answers.", "FORUM_QUESTION_LOCKED");

  let depth = 0;
  if (input.parentAnswerId) {
    const pRows = await orm
      .select({ depth: schema.forumAnswers.depth, questionId: schema.forumAnswers.questionId })
      .from(schema.forumAnswers)
      .where(and(eq(schema.forumAnswers.id, input.parentAnswerId), isNull(schema.forumAnswers.deletedAt)))
      .limit(1);
    const parent = pRows[0];
    if (!parent || parent.questionId !== input.questionId) throw notFound("Parent answer not found");
    depth = Math.min(parent.depth + 1, MAX_ANSWER_DEPTH);
  }

  const mod = eligibility.config.autoModerationEnabled
    ? await applyForumAutoModeration(
        { body: input.body, authorId: input.userId, targetType: "forum_answer" },
        orm
      )
    : { blocked: false, reason: null, filteredTitle: undefined, filteredBody: input.body };

  if (mod.blocked) {
    throw badRequest("This answer looks like a duplicate of one you posted recently.", "FORUM_CONTENT_BLOCKED");
  }

  const needsBypassCharge = eligibility.rankNumber < eligibility.config.minLevelToComment;
  const referenceId = `forum_comment_bypass:${input.userId}:${randomUUID()}`;

  const answerId = await orm.transaction(async (tx) => {
    if (needsBypassCharge && eligibility.config.commentBypassCostCredits > 0) {
      await debitCoins(
        input.userId,
        eligibility.config.commentBypassCostCredits,
        "forum_comment_bypass",
        referenceId,
        "Spent Credits to comment on Answers",
        undefined,
        tx
      );
    }

    const [answer] = await tx
      .insert(schema.forumAnswers)
      .values({
        questionId: input.questionId,
        authorId: input.userId,
        parentAnswerId: input.parentAnswerId ?? null,
        depth,
        body: mod.filteredBody,
        status: "visible",
      })
      .returning({ id: schema.forumAnswers.id });

    await tx
      .update(schema.forumQuestions)
      .set({ answerCount: sql`${schema.forumQuestions.answerCount} + 1`, lastActivityAt: sql`NOW()`, updatedAt: sql`NOW()` })
      .where(eq(schema.forumQuestions.id, input.questionId));

    return answer.id;
  });

  awardForumRewards(
    input.userId,
    eligibility.config.rewardXpPerAnswer,
    eligibility.config.rewardCreditsPerAnswer,
    "forum_answer_posted",
    "forum_answer_reward",
    `forum_answer_reward:${answerId}`,
    "Posted an answer on Answers",
    eligibility.config.dailyRewardCapCredits
  );

  return { id: answerId, status: "visible" };
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

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
  const manifest = await loadManifest();
  const orm = await getDb();

  const targetTable = targetType === "question" ? schema.forumQuestions : schema.forumAnswers;

  const result = await orm.transaction(async (tx) => {
    const targetRows = await tx
      .select({ id: targetTable.id, authorId: targetTable.authorId, voteScore: targetTable.voteScore })
      .from(targetTable)
      .where(and(eq(targetTable.id, targetId), isNull(targetTable.deletedAt)))
      .for("update");
    const target = targetRows[0];
    if (!target) throw notFound("Content not found");
    if (target.authorId === userId) {
      throw forbidden("You can't vote on your own post.", "FORUM_SELF_VOTE");
    }

    const existingRows = await tx
      .select({ value: schema.forumVotes.value })
      .from(schema.forumVotes)
      .where(and(eq(schema.forumVotes.targetType, targetType), eq(schema.forumVotes.targetId, targetId), eq(schema.forumVotes.userId, userId)))
      .for("update");
    const existing = existingRows[0]?.value ?? 0;

    let delta: number;
    let myVote: -1 | 0 | 1;

    if (existing === value) {
      // Toggle off — voting the same direction again removes the vote.
      await tx
        .delete(schema.forumVotes)
        .where(and(eq(schema.forumVotes.targetType, targetType), eq(schema.forumVotes.targetId, targetId), eq(schema.forumVotes.userId, userId)));
      delta = -existing;
      myVote = 0;
    } else if (existing === 0) {
      await tx.insert(schema.forumVotes).values({ targetType, targetId, userId, value });
      delta = value;
      myVote = value;
    } else {
      await tx
        .update(schema.forumVotes)
        .set({ value })
        .where(and(eq(schema.forumVotes.targetType, targetType), eq(schema.forumVotes.targetId, targetId), eq(schema.forumVotes.userId, userId)));
      delta = value - existing;
      myVote = value;
    }

    const updatedRows = await tx
      .update(targetTable)
      .set({ voteScore: sql`${targetTable.voteScore} + ${delta}`, updatedAt: sql`NOW()` })
      .where(eq(targetTable.id, targetId))
      .returning({ voteScore: targetTable.voteScore });

    return {
      voteScore: updatedRows[0].voteScore,
      myVote,
      authorId: target.authorId,
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
      "Received an upvote on Answers",
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

  const orm = await getDb();
  return orm.transaction(async (tx) => {
    const qRows = await tx
      .select({ id: schema.forumQuestions.id })
      .from(schema.forumQuestions)
      .where(and(eq(schema.forumQuestions.id, questionId), isNull(schema.forumQuestions.deletedAt)))
      .for("update");
    if (!qRows[0]) throw notFound("Question not found");

    if (next) {
      const inserted = await tx
        .insert(schema.forumFavorites)
        .values({ userId, questionId })
        .onConflictDoNothing({ target: [schema.forumFavorites.userId, schema.forumFavorites.questionId] })
        .returning({ userId: schema.forumFavorites.userId });
      if (inserted.length > 0) {
        await tx.update(schema.forumQuestions).set({ favoriteCount: sql`${schema.forumQuestions.favoriteCount} + 1` }).where(eq(schema.forumQuestions.id, questionId));
      }
    } else {
      const deleted = await tx
        .delete(schema.forumFavorites)
        .where(and(eq(schema.forumFavorites.userId, userId), eq(schema.forumFavorites.questionId, questionId)))
        .returning({ userId: schema.forumFavorites.userId });
      if (deleted.length > 0) {
        await tx.update(schema.forumQuestions).set({ favoriteCount: sql`GREATEST(${schema.forumQuestions.favoriteCount} - 1, 0)` }).where(eq(schema.forumQuestions.id, questionId));
      }
    }

    const rows = await tx.select({ favoriteCount: schema.forumQuestions.favoriteCount }).from(schema.forumQuestions).where(eq(schema.forumQuestions.id, questionId));
    return { favoriteCount: rows[0].favoriteCount };
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

  const orm = await getDb();
  const qRows = await orm
    .select({ authorId: schema.forumQuestions.authorId })
    .from(schema.forumQuestions)
    .where(and(eq(schema.forumQuestions.id, questionId), isNull(schema.forumQuestions.deletedAt)))
    .limit(1);
  const question = qRows[0];
  if (!question) throw notFound("Question not found");
  if (question.authorId !== callerId && !callerIsModerator) {
    throw forbidden("Only the question author or a moderator can mark the best answer.", "FORUM_NOT_QUESTION_AUTHOR");
  }

  const aRows = await orm
    .select({ id: schema.forumAnswers.id, authorId: schema.forumAnswers.authorId })
    .from(schema.forumAnswers)
    .where(and(eq(schema.forumAnswers.id, answerId), eq(schema.forumAnswers.questionId, questionId), isNull(schema.forumAnswers.deletedAt)))
    .limit(1);
  const answer = aRows[0];
  if (!answer) throw notFound("Answer not found");

  await orm.update(schema.forumQuestions).set({ bestAnswerId: answerId, updatedAt: sql`NOW()` }).where(eq(schema.forumQuestions.id, questionId));

  awardForumRewards(
    answer.authorId,
    manifest.forum.rewardXpBestAnswer,
    manifest.forum.rewardCreditsBestAnswer,
    "forum_best_answer_awarded",
    "forum_best_answer_reward",
    `forum_best_answer_reward:${answerId}`,
    "Your answer was marked best on Answers",
    manifest.forum.dailyRewardCapCredits
  );
}

// ---------------------------------------------------------------------------
// Delete / lock (author or moderator)
// ---------------------------------------------------------------------------

export async function deleteQuestion(questionId: string, callerId: string, callerIsModerator: boolean): Promise<void> {
  const orm = await getDb();
  const rows = await orm
    .select({ authorId: schema.forumQuestions.authorId })
    .from(schema.forumQuestions)
    .where(and(eq(schema.forumQuestions.id, questionId), isNull(schema.forumQuestions.deletedAt)))
    .limit(1);
  const question = rows[0];
  if (!question) throw notFound("Question not found");
  if (question.authorId !== callerId && !callerIsModerator) {
    throw forbidden("You can't delete this question.", "FORUM_NOT_AUTHOR");
  }
  await orm
    .update(schema.forumQuestions)
    .set({ status: "removed", deletedAt: sql`NOW()`, updatedAt: sql`NOW()` })
    .where(eq(schema.forumQuestions.id, questionId));
}

export async function deleteAnswer(answerId: string, callerId: string, callerIsModerator: boolean): Promise<void> {
  const orm = await getDb();
  const rows = await orm
    .select({ authorId: schema.forumAnswers.authorId, questionId: schema.forumAnswers.questionId })
    .from(schema.forumAnswers)
    .where(and(eq(schema.forumAnswers.id, answerId), isNull(schema.forumAnswers.deletedAt)))
    .limit(1);
  const answer = rows[0];
  if (!answer) throw notFound("Answer not found");
  if (answer.authorId !== callerId && !callerIsModerator) {
    throw forbidden("You can't delete this answer.", "FORUM_NOT_AUTHOR");
  }
  await orm
    .update(schema.forumAnswers)
    .set({ status: "removed", deletedAt: sql`NOW()`, updatedAt: sql`NOW()` })
    .where(eq(schema.forumAnswers.id, answerId));
  await orm
    .update(schema.forumQuestions)
    .set({ answerCount: sql`GREATEST(${schema.forumQuestions.answerCount} - 1, 0)` })
    .where(eq(schema.forumQuestions.id, answer.questionId));
}

export async function setQuestionLocked(questionId: string, locked: boolean): Promise<void> {
  const orm = await getDb();
  const updated = await orm
    .update(schema.forumQuestions)
    .set({ isLocked: locked, updatedAt: sql`NOW()` })
    .where(and(eq(schema.forumQuestions.id, questionId), isNull(schema.forumQuestions.deletedAt)))
    .returning({ id: schema.forumQuestions.id });
  if (!updated.length) throw notFound("Question not found");
}
