/**
 * lib/quizzes/service.ts
 *
 * Quizzes — user-created quizzes other users take, at /quiz/<slug>.
 * Mirrors lib/polls/service.ts (which mirrors lib/forum/service.ts):
 * feature flag -> eligibility -> level gate -> atomic write -> best-effort
 * reward. A quiz creator may fund a reward pot (treasury, shared with Polls
 * via lib/contentTreasury.ts) that the first N users who PASS split evenly —
 * "quiz creator can specify prices in credits for first x users who pass
 * the quiz" per product spec.
 *
 * @module lib/quizzes/service
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import type { TransactionClient, SqlParam } from "@/lib/db/interface";
import { loadManifest, requireFeatureEnabled, type ZobiaManifest } from "@/lib/manifest";
import { getRankForXP } from "@/lib/xp/engine";
import { safeAwardXPFireAndForget } from "@/lib/xp/safeAwardXP";
import { creditCoins } from "@/lib/economy/coins";
import { generateUniqueSlug } from "@/lib/slug";
import { fundContentTreasury, claimContentTreasuryReward, getContentTreasury, recordContentShare, type TreasuryState } from "@/lib/contentTreasury";
import { badRequest, forbidden, notFound } from "@/lib/api/errors";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export interface QuizEligibility {
  rankNumber: number;
  config: ZobiaManifest["quizzes"];
}

export async function getQuizEligibility(userId: string): Promise<QuizEligibility> {
  const [manifest, userRows] = await Promise.all([
    loadManifest(),
    db.query<{ xp_total: number }>(`SELECT COALESCE(xp_total, 0) AS xp_total FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [userId]),
  ]);
  const row = userRows.rows[0];
  if (!row) throw forbidden("User account not found");
  return { rankNumber: getRankForXP(row.xp_total).rankNumber, config: manifest.quizzes };
}

function assertCanCreate(eligibility: QuizEligibility): void {
  if (eligibility.rankNumber < eligibility.config.minLevelToCreate) {
    throw forbidden(
      `You must reach Level ${eligibility.config.minLevelToCreate} to create a quiz. Your current level is ${eligibility.rankNumber}.`,
      "QUIZ_LEVEL_TOO_LOW",
      { minLevel: eligibility.config.minLevelToCreate, currentLevel: eligibility.rankNumber }
    );
  }
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

async function awardCreditsCapped(userId: string, amount: number, referenceId: string, description: string, dailyCapCredits: number): Promise<void> {
  if (amount <= 0) return;
  try {
    const { rows } = await db.query<{ earned: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS earned
       FROM coin_ledger
       WHERE user_id = $1 AND transaction_type LIKE 'quiz_%' AND amount > 0
         AND created_at >= NOW() - INTERVAL '24 hours'`,
      [userId]
    );
    const earnedToday = parseInt(rows[0]?.earned ?? "0", 10);
    const headroom = dailyCapCredits - earnedToday;
    if (headroom <= 0) return;
    const capped = Math.min(amount, headroom);
    await creditCoins(userId, capped, "quiz_create_reward", referenceId, description);
  } catch (err) {
    logger.error({ err, userId, amount }, "[quizzes/service] reward credit award failed");
  }
}

function awardQuizRewards(userId: string, xpAmount: number, creditAmount: number, xpSource: string, referenceId: string, description: string, dailyCapCredits: number): void {
  if (xpAmount > 0) safeAwardXPFireAndForget(userId, xpAmount, "knowledge", xpSource, referenceId);
  if (creditAmount > 0) awardCreditsCapped(userId, creditAmount, referenceId, description, dailyCapCredits).catch(() => {});
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateQuizQuestionInput {
  prompt: string;
  type: "single" | "multiple" | "true_false";
  points?: number;
  options: { label: string; isCorrect: boolean }[];
}

export interface CreateQuizInput {
  userId: string;
  title: string;
  description?: string | null;
  passingScorePercent?: number;
  maxAttemptsPerUser?: number;
  questions: CreateQuizQuestionInput[];
}

export interface QuizSummary {
  id: string;
  slug: string;
}

function validateQuestions(questions: CreateQuizQuestionInput[], maxQuestions: number): void {
  if (questions.length === 0) throw badRequest("A quiz needs at least 1 question.", "QUIZ_NO_QUESTIONS");
  if (questions.length > maxQuestions) throw badRequest(`A quiz may have at most ${maxQuestions} questions.`, "QUIZ_TOO_MANY_QUESTIONS");
  for (const q of questions) {
    if (!q.prompt.trim()) throw badRequest("Every question needs a prompt.", "QUIZ_EMPTY_PROMPT");
    const options = q.options.filter((o) => o.label.trim());
    if (options.length < 2) throw badRequest("Every question needs at least 2 options.", "QUIZ_NOT_ENOUGH_OPTIONS");
    const correctCount = options.filter((o) => o.isCorrect).length;
    if (correctCount === 0) throw badRequest("Every question needs at least one correct answer.", "QUIZ_NO_CORRECT_ANSWER");
    if (q.type === "single" || q.type === "true_false") {
      if (correctCount > 1) throw badRequest("Single-answer questions may only have one correct option.", "QUIZ_TOO_MANY_CORRECT_ANSWERS");
    }
  }
}

export async function createQuiz(input: CreateQuizInput): Promise<QuizSummary> {
  await requireFeatureEnabled("quizzes");
  const eligibility = await getQuizEligibility(input.userId);
  assertCanCreate(eligibility);
  validateQuestions(input.questions, eligibility.config.maxQuestions);

  const passingScorePercent = input.passingScorePercent ?? 60;
  if (!Number.isInteger(passingScorePercent) || passingScorePercent < 0 || passingScorePercent > 100) {
    throw badRequest("Passing score must be between 0 and 100.", "QUIZ_INVALID_PASSING_SCORE");
  }
  const maxAttemptsPerUser = input.maxAttemptsPerUser ?? eligibility.config.defaultMaxAttempts;
  if (!Number.isInteger(maxAttemptsPerUser) || maxAttemptsPerUser < 1) {
    throw badRequest("Max attempts must be at least 1.", "QUIZ_INVALID_MAX_ATTEMPTS");
  }

  const quizId = randomUUID();
  const slug = await generateUniqueSlug("quiz", input.title, quizId);

  await db.transaction(async (tx: TransactionClient) => {
    await tx.query(
      `INSERT INTO quizzes (id, creator_id, slug, title, description, passing_score_percent, max_attempts_per_user)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [quizId, input.userId, slug, input.title.trim(), input.description?.trim() || null, passingScorePercent, maxAttemptsPerUser]
    );
    for (let qi = 0; qi < input.questions.length; qi++) {
      const q = input.questions[qi];
      const { rows: qRows } = await tx.query<{ id: string }>(
        `INSERT INTO quiz_questions (quiz_id, position, prompt, type, points) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [quizId, qi, q.prompt.trim(), q.type, q.points && q.points > 0 ? q.points : 1]
      );
      const questionId = qRows[0].id;
      const options = q.options.filter((o) => o.label.trim());
      for (let oi = 0; oi < options.length; oi++) {
        await tx.query(`INSERT INTO quiz_question_options (question_id, label, is_correct, position) VALUES ($1, $2, $3, $4)`, [questionId, options[oi].label.trim(), options[oi].isCorrect, oi]);
      }
    }
  });

  awardQuizRewards(
    input.userId,
    eligibility.config.rewardXpCreator,
    eligibility.config.rewardCreditsCreator,
    "quiz_created",
    `quiz_create_reward:${quizId}`,
    "Created a quiz",
    eligibility.config.dailyRewardCapCredits
  );

  return { id: quizId, slug };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface QuizQuestionView {
  id: string;
  prompt: string;
  type: string;
  points: number;
  options: { id: string; label: string; isCorrect?: boolean }[];
}

export interface QuizDetail {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  passingScorePercent: number;
  maxAttemptsPerUser: number;
  viewCount: number;
  attemptCount: number;
  shareCount: number;
  createdAt: string;
  creatorId: string;
  creatorUsername: string | null;
  creatorAvatarUrl: string | null;
  questions: QuizQuestionView[];
  isOwner: boolean;
  myAttemptCount: number;
  myBestAttempt: { score: number; totalPoints: number; scorePercent: number; passed: boolean } | null;
}

interface QuizRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  passing_score_percent: number;
  max_attempts_per_user: number;
  view_count: number;
  attempt_count: number;
  share_count: number;
  created_at: string;
  creator_id: string;
  creator_username: string | null;
  creator_avatar_url: string | null;
}

/** includeAnswers=true reveals is_correct — only for the owner/admin, never for a taker before they submit. */
export async function getQuizBySlug(slug: string, viewerId?: string | null, includeAnswers = false): Promise<QuizDetail | null> {
  const { rows } = await db.query<QuizRow>(
    `SELECT q.id, q.slug, q.title, q.description, q.status, q.passing_score_percent, q.max_attempts_per_user,
            q.view_count, q.attempt_count, q.share_count, q.created_at, q.creator_id,
            u.username AS creator_username, u.avatar_url AS creator_avatar_url
     FROM quizzes q
     JOIN users u ON u.id = q.creator_id
     WHERE q.slug = $1 AND q.deleted_at IS NULL LIMIT 1`,
    [slug]
  );
  const quiz = rows[0];
  if (!quiz) return null;

  const isOwner = viewerId === quiz.creator_id;
  const revealAnswers = includeAnswers && isOwner;

  const { rows: questionRows } = await db.query<{ id: string; prompt: string; type: string; points: number }>(
    `SELECT id, prompt, type, points FROM quiz_questions WHERE quiz_id = $1 ORDER BY position ASC`,
    [quiz.id]
  );
  const { rows: optionRows } = await db.query<{ id: string; question_id: string; label: string; is_correct: boolean }>(
    `SELECT o.id, o.question_id, o.label, o.is_correct FROM quiz_question_options o
     JOIN quiz_questions q ON q.id = o.question_id WHERE q.quiz_id = $1 ORDER BY o.position ASC`,
    [quiz.id]
  );

  const questions: QuizQuestionView[] = questionRows.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    type: q.type,
    points: q.points,
    options: optionRows
      .filter((o) => o.question_id === q.id)
      .map((o) => (revealAnswers ? { id: o.id, label: o.label, isCorrect: o.is_correct } : { id: o.id, label: o.label })),
  }));

  let myAttemptCount = 0;
  let myBestAttempt: QuizDetail["myBestAttempt"] = null;
  if (viewerId) {
    const { rows: attemptRows } = await db.query<{ score: number; total_points: number; score_percent: number; passed: boolean }>(
      `SELECT score, total_points, score_percent, passed FROM quiz_attempts WHERE quiz_id = $1 AND user_id = $2 ORDER BY score_percent DESC LIMIT 1`,
      [quiz.id, viewerId]
    );
    const { rows: countRows } = await db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM quiz_attempts WHERE quiz_id = $1 AND user_id = $2`, [quiz.id, viewerId]);
    myAttemptCount = parseInt(countRows[0]?.count ?? "0", 10);
    if (attemptRows[0]) {
      myBestAttempt = { score: attemptRows[0].score, totalPoints: attemptRows[0].total_points, scorePercent: attemptRows[0].score_percent, passed: attemptRows[0].passed };
    }
  }

  return {
    id: quiz.id,
    slug: quiz.slug,
    title: quiz.title,
    description: quiz.description,
    status: quiz.status,
    passingScorePercent: quiz.passing_score_percent,
    maxAttemptsPerUser: quiz.max_attempts_per_user,
    viewCount: quiz.view_count,
    attemptCount: quiz.attempt_count,
    shareCount: quiz.share_count,
    createdAt: quiz.created_at,
    creatorId: quiz.creator_id,
    creatorUsername: quiz.creator_username,
    creatorAvatarUrl: quiz.creator_avatar_url,
    questions,
    isOwner,
    myAttemptCount,
    myBestAttempt,
  };
}

export async function recordQuizView(quizId: string): Promise<void> {
  await db.query(`UPDATE quizzes SET view_count = view_count + 1 WHERE id = $1`, [quizId]).catch(() => {});
}

export interface ListQuizzesResult {
  quizzes: Array<{ id: string; slug: string; title: string; attemptCount: number; createdAt: string; creatorUsername: string | null }>;
  nextCursor: string | null;
}

export async function listQuizzes(tab: "new" | "popular" | "mine", cursor: string | undefined, limit: number, viewerId?: string | null): Promise<ListQuizzesResult> {
  const params: SqlParam[] = [];
  let where = `q.status = 'active' AND q.deleted_at IS NULL`;
  if (tab === "mine") {
    if (!viewerId) throw forbidden("Sign in to view your quizzes.");
    params.push(viewerId);
    where = `q.creator_id = $${params.length} AND q.deleted_at IS NULL`;
  }
  if (cursor) {
    params.push(cursor);
    where += ` AND q.created_at < (SELECT created_at FROM quizzes WHERE id = $${params.length})`;
  }
  params.push(limit);
  const orderBy = tab === "popular" ? "q.attempt_count DESC, q.created_at DESC" : "q.created_at DESC";

  const { rows } = await db.query<{ id: string; slug: string; title: string; attempt_count: number; created_at: string; creator_username: string | null }>(
    `SELECT q.id, q.slug, q.title, q.attempt_count, q.created_at, u.username AS creator_username
     FROM quizzes q JOIN users u ON u.id = q.creator_id
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT $${params.length}`,
    params
  );

  return {
    quizzes: rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title, attemptCount: r.attempt_count, createdAt: r.created_at, creatorUsername: r.creator_username })),
    nextCursor: rows.length === limit ? rows[rows.length - 1].id : null,
  };
}

// ---------------------------------------------------------------------------
// Attempt (submit)
// ---------------------------------------------------------------------------

export interface SubmitAttemptInput {
  userId: string;
  quizId: string;
  answers: { questionId: string; selectedOptionIds: string[] }[];
}

export interface SubmitAttemptResult {
  score: number;
  totalPoints: number;
  scorePercent: number;
  passed: boolean;
  rewardClaimed: number | null;
  perQuestionResult: { questionId: string; isCorrect: boolean; correctOptionIds: string[] }[];
}

export async function submitQuizAttempt(input: SubmitAttemptInput): Promise<SubmitAttemptResult> {
  await requireFeatureEnabled("quizzes");

  const { rows: quizRows } = await db.query<{ id: string; status: string; passing_score_percent: number; max_attempts_per_user: number }>(
    `SELECT id, status, passing_score_percent, max_attempts_per_user FROM quizzes WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [input.quizId]
  );
  const quiz = quizRows[0];
  if (!quiz) throw notFound("Quiz not found");
  if (quiz.status !== "active") throw badRequest("This quiz is no longer accepting attempts.", "QUIZ_NOT_ACTIVE");

  const { rows: countRows } = await db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM quiz_attempts WHERE quiz_id = $1 AND user_id = $2`, [input.quizId, input.userId]);
  const attemptsSoFar = parseInt(countRows[0]?.count ?? "0", 10);
  if (attemptsSoFar >= quiz.max_attempts_per_user) throw badRequest("You've used all your attempts on this quiz.", "QUIZ_MAX_ATTEMPTS_REACHED");

  const { rows: questionRows } = await db.query<{ id: string; type: string; points: number }>(`SELECT id, type, points FROM quiz_questions WHERE quiz_id = $1`, [input.quizId]);
  if (questionRows.length === 0) throw badRequest("This quiz has no questions.", "QUIZ_NO_QUESTIONS");
  const { rows: optionRows } = await db.query<{ id: string; question_id: string; is_correct: boolean }>(
    `SELECT o.id, o.question_id, o.is_correct FROM quiz_question_options o
     JOIN quiz_questions q ON q.id = o.question_id WHERE q.quiz_id = $1`,
    [input.quizId]
  );

  let score = 0;
  let totalPoints = 0;
  const perQuestionResult: SubmitAttemptResult["perQuestionResult"] = [];
  const gradedAnswers: { questionId: string; selectedOptionIds: string[]; isCorrect: boolean }[] = [];

  for (const q of questionRows) {
    totalPoints += q.points;
    const correctOptionIds = optionRows.filter((o) => o.question_id === q.id && o.is_correct).map((o) => o.id);
    const submitted = input.answers.find((a) => a.questionId === q.id);
    const selectedOptionIds = submitted?.selectedOptionIds ?? [];
    const isCorrect =
      selectedOptionIds.length === correctOptionIds.length && selectedOptionIds.every((id) => correctOptionIds.includes(id));
    if (isCorrect) score += q.points;
    perQuestionResult.push({ questionId: q.id, isCorrect, correctOptionIds });
    gradedAnswers.push({ questionId: q.id, selectedOptionIds, isCorrect });
  }

  const scorePercent = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;
  const passed = scorePercent >= quiz.passing_score_percent;

  await db.transaction(async (tx: TransactionClient) => {
    const { rows: attemptRows } = await tx.query<{ id: string }>(
      `INSERT INTO quiz_attempts (quiz_id, user_id, attempt_number, score, total_points, score_percent, passed, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id`,
      [input.quizId, input.userId, attemptsSoFar + 1, score, totalPoints, scorePercent, passed]
    );
    const attemptId = attemptRows[0].id;
    for (const a of gradedAnswers) {
      await tx.query(`INSERT INTO quiz_attempt_answers (attempt_id, question_id, selected_option_ids, is_correct) VALUES ($1, $2, $3, $4)`, [
        attemptId,
        a.questionId,
        JSON.stringify(a.selectedOptionIds),
        a.isCorrect,
      ]);
    }
    await tx.query(`UPDATE quizzes SET attempt_count = attempt_count + 1 WHERE id = $1`, [input.quizId]);
  });

  const manifest = await loadManifest();
  awardQuizRewards(
    input.userId,
    manifest.quizzes.rewardXpTaker,
    manifest.quizzes.rewardCreditsTaker,
    "quiz_taken",
    `quiz_attempt_reward:${input.quizId}:${input.userId}:${attemptsSoFar + 1}`,
    "Took a quiz",
    manifest.quizzes.dailyRewardCapCredits
  );

  let rewardClaimed: number | null = null;
  if (passed) {
    const claim = await claimContentTreasuryReward("quiz", input.quizId, input.userId, "pass", "quiz_treasury_claim", manifest.features.quizMonetization).catch((err) => {
      logger.error({ err, quizId: input.quizId, userId: input.userId }, "[quizzes/service] failed to claim treasury reward for pass");
      return null;
    });
    rewardClaimed = claim?.amount ?? null;
  }

  return { score, totalPoints, scorePercent, passed, rewardClaimed, perQuestionResult };
}

// ---------------------------------------------------------------------------
// Share + Treasury
// ---------------------------------------------------------------------------

export async function shareQuiz(userId: string, quizId: string): Promise<{ shareCount: number; rewardClaimed: number | null }> {
  await requireFeatureEnabled("quizzes");
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM quizzes WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [quizId]);
  if (!rows[0]) throw notFound("Quiz not found");

  const manifest = await loadManifest();
  const { rewardClaimed } = await recordContentShare("quiz", quizId, userId, "quiz_treasury_claim", manifest.features.quizMonetization, async (tx) => {
    await tx.query(`UPDATE quizzes SET share_count = share_count + 1 WHERE id = $1`, [quizId]);
  });

  const { rows: countRows } = await db.query<{ share_count: number }>(`SELECT share_count FROM quizzes WHERE id = $1`, [quizId]);
  return { shareCount: countRows[0]?.share_count ?? 0, rewardClaimed };
}

export async function getQuizTreasury(quizId: string): Promise<TreasuryState | null> {
  return getContentTreasury("quiz", quizId);
}

/** Only the quiz's own creator may fund its reward pot — see fundPollTreasury's docstring for why there's no admin-on-behalf-of bypass. */
export async function fundQuizTreasury(userId: string, quizId: string, amount: number, maxClaimants: number): Promise<TreasuryState> {
  await requireFeatureEnabled("quizzes");
  await requireFeatureEnabled("quizMonetization");
  const { rows } = await db.query<{ creator_id: string }>(`SELECT creator_id FROM quizzes WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [quizId]);
  const quiz = rows[0];
  if (!quiz) throw notFound("Quiz not found");
  if (quiz.creator_id !== userId) throw forbidden("Only the quiz's creator can fund its reward pot.");
  return fundContentTreasury(userId, "quiz", quizId, amount, maxClaimants, "quiz_treasury_fund");
}

// ---------------------------------------------------------------------------
// Ownership / moderation helpers
// ---------------------------------------------------------------------------

export async function getQuizIdBySlug(slug: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM quizzes WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`, [slug]);
  return rows[0]?.id ?? null;
}

export async function assertQuizOwnerOrAdmin(quizId: string, userId: string, isAdmin: boolean): Promise<{ creatorId: string }> {
  const { rows } = await db.query<{ creator_id: string }>(`SELECT creator_id FROM quizzes WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [quizId]);
  const quiz = rows[0];
  if (!quiz) throw notFound("Quiz not found");
  if (quiz.creator_id !== userId && !isAdmin) throw forbidden("Only the quiz's creator or an admin can do this.");
  return { creatorId: quiz.creator_id };
}

export async function setQuizStatus(quizId: string, status: "active" | "closed" | "disabled"): Promise<void> {
  const { rowCount } = await db.query(`UPDATE quizzes SET status = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [quizId, status]);
  if (!rowCount) throw notFound("Quiz not found");
}

export async function deleteQuiz(quizId: string): Promise<void> {
  const { rowCount } = await db.query(`UPDATE quizzes SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [quizId]);
  if (!rowCount) throw notFound("Quiz not found");
}
