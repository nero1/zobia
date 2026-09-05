/**
 * lib/forum/repo.ts
 *
 * Answers (mini forum / Q&A) — read-side queries.
 *
 * Cursor pagination follows the LIMIT-n+1 "peek" pattern used elsewhere in
 * the codebase (see lib/games/repo.ts listFavoriteGames). Vote/favorite
 * state for the caller is always SQL-joined, never fetched per-item from
 * Redis — see docs/HOW-IT-WORKS.md's Redis-avoidance conventions.
 *
 * @module lib/forum/repo
 */

import { db } from "@/lib/db";
import type { SqlParam } from "@/lib/db/interface";
import { MAX_ANSWER_DEPTH } from "@/lib/forum/service";

export type ForumTab = "popular" | "trending" | "new" | "favorites";
export type PublicCategoryTab = "latest" | "new" | "trending" | "popular";
export type AnswerSort = "best" | "new";

const AUTHOR_COLUMNS = `
  u.id AS author_id,
  u.username AS author_username,
  u.display_name AS author_display_name,
  u.avatar_emoji AS author_avatar_emoji
`;

export interface ForumAuthor {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarEmoji: string | null;
}

export interface ForumQuestionSummary {
  id: string;
  slug: string | null;
  title: string;
  body: string;
  author: ForumAuthor;
  voteScore: number;
  answerCount: number;
  favoriteCount: number;
  isLocked: boolean;
  bestAnswerId: string | null;
  createdAt: string;
  lastActivityAt: string;
  myVote: -1 | 0 | 1;
  isFavorited: boolean;
}

interface QuestionRow {
  id: string;
  slug: string | null;
  title: string;
  body: string;
  author_id: string;
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_emoji: string | null;
  vote_score: number;
  answer_count: number;
  favorite_count: number;
  is_locked: boolean;
  best_answer_id: string | null;
  created_at: string;
  last_activity_at: string;
  my_vote: number | null;
  is_favorited: boolean;
}

function toQuestionSummary(row: QuestionRow): ForumQuestionSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    author: {
      id: row.author_id,
      username: row.author_username,
      displayName: row.author_display_name,
      avatarEmoji: row.author_avatar_emoji,
    },
    voteScore: row.vote_score,
    answerCount: row.answer_count,
    favoriteCount: row.favorite_count,
    isLocked: row.is_locked,
    bestAnswerId: row.best_answer_id,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    myVote: (row.my_vote ?? 0) as -1 | 0 | 1,
    isFavorited: row.is_favorited,
  };
}

export interface ListQuestionsResult {
  questions: ForumQuestionSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Cursor-paginated question list for the four forum tabs.
 *
 * `trending` uses a simple recency-windowed activity count (votes + answers
 * in the last 48h) rather than a logarithmic hot-rank formula, consistent
 * with the simple-SQL convention already used for rooms.trending_score.
 */
export async function listQuestions(
  callerId: string,
  tab: ForumTab,
  cursor: string | undefined,
  limit: number
): Promise<ListQuestionsResult> {
  const pageSize = Math.min(limit, 50);
  const params: SqlParam[] = [callerId];

  const favoritesJoin = tab === "favorites"
    ? `JOIN forum_favorites ff ON ff.question_id = q.id AND ff.user_id = $1`
    : "";

  let cursorClause = "";
  let orderClause = "";

  if (tab === "new") {
    orderClause = "q.created_at DESC";
    if (cursor) { params.push(cursor); cursorClause = `AND q.created_at < $${params.length}`; }
  } else if (tab === "popular") {
    orderClause = "q.vote_score DESC, q.created_at DESC";
    if (cursor) {
      const [voteScore, createdAt] = cursor.split("|");
      params.push(Number(voteScore), createdAt);
      cursorClause = `AND (q.vote_score < $${params.length - 1} OR (q.vote_score = $${params.length - 1} AND q.created_at < $${params.length}))`;
    }
  } else if (tab === "favorites") {
    orderClause = "ff.created_at DESC";
    if (cursor) { params.push(cursor); cursorClause = `AND ff.created_at < $${params.length}`; }
  } else {
    // trending
    orderClause = "trending_score DESC, q.last_activity_at DESC";
    if (cursor) {
      const [score, lastActivity] = cursor.split("|");
      params.push(Number(score), lastActivity);
      cursorClause = `AND (trending_score < $${params.length - 1} OR (trending_score = $${params.length - 1} AND q.last_activity_at < $${params.length}))`;
    }
  }

  params.push(pageSize + 1);

  const trendingExpr = `(
    COALESCE((SELECT COUNT(*) FROM forum_votes v WHERE v.target_type = 'question' AND v.target_id = q.id AND v.created_at > NOW() - INTERVAL '48 hours'), 0) +
    COALESCE((SELECT COUNT(*) FROM forum_answers a WHERE a.question_id = q.id AND a.created_at > NOW() - INTERVAL '48 hours' AND a.deleted_at IS NULL), 0)
  )`;

  const { rows } = await db.query<QuestionRow & { trending_score?: number }>(
    `SELECT q.id, q.slug, q.title, q.body, ${AUTHOR_COLUMNS},
            q.vote_score, q.answer_count, q.favorite_count, q.is_locked, q.best_answer_id,
            q.created_at, q.last_activity_at,
            v.value AS my_vote,
            ${tab === "favorites" ? "TRUE" : "(fav.id IS NOT NULL)"} AS is_favorited
            ${tab === "trending" ? `, ${trendingExpr} AS trending_score` : ""}
     FROM forum_questions q
     JOIN users u ON u.id = q.author_id
     ${favoritesJoin}
     LEFT JOIN forum_votes v ON v.target_type = 'question' AND v.target_id = q.id AND v.user_id = $1
     ${tab === "favorites" ? "" : "LEFT JOIN forum_favorites fav ON fav.question_id = q.id AND fav.user_id = $1"}
     WHERE q.status = 'visible' AND q.deleted_at IS NULL ${cursorClause}
     ORDER BY ${orderClause}
     LIMIT $${params.length}`,
    params
  );

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    if (tab === "new") nextCursor = last.created_at;
    else if (tab === "popular") nextCursor = `${last.vote_score}|${last.created_at}`;
    else if (tab === "favorites") nextCursor = last.created_at;
    else nextCursor = `${last.trending_score ?? 0}|${last.last_activity_at}`;
  }

  return { questions: items.map(toQuestionSummary), nextCursor, hasMore };
}

// ---------------------------------------------------------------------------
// Public (unauthenticated) category browsing — powers the SEO-indexable
// /answers/category/<slug> page. No per-caller vote/favorite state (public,
// anonymous-safe), unlike listQuestions above.
// ---------------------------------------------------------------------------

export interface PublicCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconEmoji: string;
  questionCount: number;
}

export async function getPublicCategory(slug: string): Promise<PublicCategory | null> {
  const { rows } = await db.query<{ id: string; slug: string; name: string; description: string | null; icon_emoji: string; question_count: string }>(
    `SELECT c.id, c.slug, c.name, c.description, c.icon_emoji,
            COUNT(q.id) FILTER (WHERE q.status = 'visible' AND q.deleted_at IS NULL) AS question_count
     FROM forum_categories c
     LEFT JOIN forum_questions q ON q.category_id = c.id
     WHERE c.slug = $1
     GROUP BY c.id`,
    [slug]
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, slug: row.slug, name: row.name, description: row.description, iconEmoji: row.icon_emoji, questionCount: Number(row.question_count) };
}

export async function listAllCategoriesPublic(): Promise<PublicCategory[]> {
  const { rows } = await db.query<{ id: string; slug: string; name: string; description: string | null; icon_emoji: string; question_count: string }>(
    `SELECT c.id, c.slug, c.name, c.description, c.icon_emoji,
            COUNT(q.id) FILTER (WHERE q.status = 'visible' AND q.deleted_at IS NULL) AS question_count
     FROM forum_categories c
     LEFT JOIN forum_questions q ON q.category_id = c.id
     GROUP BY c.id
     ORDER BY c.sort_order ASC, c.name ASC`
  );
  return rows.map((row) => ({ id: row.id, slug: row.slug, name: row.name, description: row.description, iconEmoji: row.icon_emoji, questionCount: Number(row.question_count) }));
}

export interface PublicQuestionCard {
  id: string;
  slug: string | null;
  title: string;
  voteScore: number;
  answerCount: number;
  createdAt: string;
  authorUsername: string | null;
}

function publicOrderClause(tab: PublicCategoryTab): string {
  if (tab === "new" || tab === "latest") return "q.created_at DESC";
  if (tab === "popular") return "q.vote_score DESC, q.created_at DESC";
  // trending: recency-windowed activity, same simple formula as listQuestions above
  return `(
    COALESCE((SELECT COUNT(*) FROM forum_votes v WHERE v.target_type = 'question' AND v.target_id = q.id AND v.created_at > NOW() - INTERVAL '48 hours'), 0) +
    COALESCE((SELECT COUNT(*) FROM forum_answers a WHERE a.question_id = q.id AND a.created_at > NOW() - INTERVAL '48 hours' AND a.deleted_at IS NULL), 0)
  ) DESC, q.last_activity_at DESC`;
}

/** Public, cursor-less (LIMIT only) question list scoped to one category — used by the SEO category page's tabs. */
export async function listPublicQuestionsByCategory(categoryId: string, tab: PublicCategoryTab, limit = 15): Promise<PublicQuestionCard[]> {
  const { rows } = await db.query<{ id: string; slug: string | null; title: string; vote_score: number; answer_count: number; created_at: string; author_username: string | null }>(
    `SELECT q.id, q.slug, q.title, q.vote_score, q.answer_count, q.created_at, u.username AS author_username
     FROM forum_questions q
     JOIN users u ON u.id = q.author_id
     WHERE q.category_id = $1 AND q.status = 'visible' AND q.deleted_at IS NULL
     ORDER BY ${publicOrderClause(tab)}
     LIMIT $2`,
    [categoryId, Math.min(limit, 50)]
  );
  return rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title, voteScore: r.vote_score, answerCount: r.answer_count, createdAt: r.created_at, authorUsername: r.author_username }));
}

/** Up to `limit` other visible questions in the same category (excludes `excludeQuestionId`). */
export async function listRelatedQuestions(categoryId: string | null, excludeQuestionId: string, limit = 5): Promise<PublicQuestionCard[]> {
  if (!categoryId) return [];
  const { rows } = await db.query<{ id: string; slug: string | null; title: string; vote_score: number; answer_count: number; created_at: string; author_username: string | null }>(
    `SELECT q.id, q.slug, q.title, q.vote_score, q.answer_count, q.created_at, u.username AS author_username
     FROM forum_questions q
     JOIN users u ON u.id = q.author_id
     WHERE q.category_id = $1 AND q.id != $2 AND q.status = 'visible' AND q.deleted_at IS NULL
     ORDER BY q.last_activity_at DESC
     LIMIT $3`,
    [categoryId, excludeQuestionId, limit]
  );
  return rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title, voteScore: r.vote_score, answerCount: r.answer_count, createdAt: r.created_at, authorUsername: r.author_username }));
}

/** Most recently created questions platform-wide, for "New posts" mini-lists. */
export async function listNewQuestions(limit = 3, excludeQuestionId?: string): Promise<PublicQuestionCard[]> {
  const { rows } = await db.query<{ id: string; slug: string | null; title: string; vote_score: number; answer_count: number; created_at: string; author_username: string | null }>(
    `SELECT q.id, q.slug, q.title, q.vote_score, q.answer_count, q.created_at, u.username AS author_username
     FROM forum_questions q
     JOIN users u ON u.id = q.author_id
     WHERE q.status = 'visible' AND q.deleted_at IS NULL ${excludeQuestionId ? "AND q.id != $2" : ""}
     ORDER BY q.created_at DESC
     LIMIT $1`,
    excludeQuestionId ? [limit, excludeQuestionId] : [limit]
  );
  return rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title, voteScore: r.vote_score, answerCount: r.answer_count, createdAt: r.created_at, authorUsername: r.author_username }));
}

/** Most recently answered questions (an answer was posted, or best-answer marked), for "Recently answered" mini-lists. */
export async function listRecentlyAnsweredQuestions(limit = 3, excludeQuestionId?: string): Promise<PublicQuestionCard[]> {
  const { rows } = await db.query<{ id: string; slug: string | null; title: string; vote_score: number; answer_count: number; created_at: string; author_username: string | null }>(
    `SELECT q.id, q.slug, q.title, q.vote_score, q.answer_count, q.created_at, u.username AS author_username
     FROM forum_questions q
     JOIN users u ON u.id = q.author_id
     WHERE q.status = 'visible' AND q.deleted_at IS NULL AND q.answer_count > 0 ${excludeQuestionId ? "AND q.id != $2" : ""}
     ORDER BY q.last_activity_at DESC
     LIMIT $1`,
    excludeQuestionId ? [limit, excludeQuestionId] : [limit]
  );
  return rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title, voteScore: r.vote_score, answerCount: r.answer_count, createdAt: r.created_at, authorUsername: r.author_username }));
}

export interface ForumQuestionDetail extends ForumQuestionSummary {
  isAuthor: boolean;
}

/**
 * Looks up a question by its UUID or its slug (SEO-friendly URLs resolve to
 * either — see lib/public/resolveForumQuestion.ts for the crawlable-page
 * variant that also handles legacy/retired slugs via slug_redirects).
 */
export async function getQuestionDetail(callerId: string, identifier: string): Promise<ForumQuestionDetail | null> {
  const { rows } = await db.query<QuestionRow>(
    `SELECT q.id, q.slug, q.title, q.body, ${AUTHOR_COLUMNS},
            q.vote_score, q.answer_count, q.favorite_count, q.is_locked, q.best_answer_id,
            q.created_at, q.last_activity_at,
            v.value AS my_vote,
            (fav.id IS NOT NULL) AS is_favorited
     FROM forum_questions q
     JOIN users u ON u.id = q.author_id
     LEFT JOIN forum_votes v ON v.target_type = 'question' AND v.target_id = q.id AND v.user_id = $2
     LEFT JOIN forum_favorites fav ON fav.question_id = q.id AND fav.user_id = $2
     WHERE (q.id::text = $1 OR q.slug = $1) AND q.status = 'visible' AND q.deleted_at IS NULL
     LIMIT 1`,
    [identifier, callerId]
  );
  const row = rows[0];
  if (!row) return null;
  return { ...toQuestionSummary(row), isAuthor: row.author_id === callerId };
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export interface ForumAnswerSummary {
  id: string;
  questionId: string;
  parentAnswerId: string | null;
  depth: number;
  body: string;
  author: ForumAuthor;
  voteScore: number;
  createdAt: string;
  myVote: -1 | 0 | 1;
  isBestAnswer: boolean;
  /** Up to 3 eagerly-loaded direct replies, most useful first. */
  replies: ForumAnswerSummary[];
  /** Total direct reply count (may exceed replies.length — "View N more replies"). */
  replyCount: number;
}

interface AnswerRow {
  id: string;
  question_id: string;
  parent_answer_id: string | null;
  depth: number;
  body: string;
  author_id: string;
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_emoji: string | null;
  vote_score: number;
  created_at: string;
  my_vote: number | null;
}

function toAnswerSummary(row: AnswerRow, bestAnswerId: string | null, replyCounts: Map<string, number>): ForumAnswerSummary {
  return {
    id: row.id,
    questionId: row.question_id,
    parentAnswerId: row.parent_answer_id,
    depth: row.depth,
    body: row.body,
    author: {
      id: row.author_id,
      username: row.author_username,
      displayName: row.author_display_name,
      avatarEmoji: row.author_avatar_emoji,
    },
    voteScore: row.vote_score,
    createdAt: row.created_at,
    myVote: (row.my_vote ?? 0) as -1 | 0 | 1,
    isBestAnswer: row.id === bestAnswerId,
    replies: [],
    replyCount: replyCounts.get(row.id) ?? 0,
  };
}

export interface ListAnswersResult {
  answers: ForumAnswerSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Cursor-paginated TOP-LEVEL answers (parent_answer_id IS NULL), each with
 * up to 3 eagerly-nested direct replies (one extra query — not a full
 * recursive CTE). Deeper/further replies are lazy-loaded on demand via
 * getAnswerThread().
 */
export async function listAnswers(
  callerId: string,
  questionId: string,
  cursor: string | undefined,
  limit: number,
  sort: AnswerSort
): Promise<ListAnswersResult> {
  const pageSize = Math.min(limit, 25);
  const params: SqlParam[] = [questionId, callerId];
  let cursorClause = "";
  const orderClause = sort === "best" ? "a.vote_score DESC, a.created_at ASC" : "a.created_at DESC";

  if (cursor) {
    if (sort === "best") {
      const [voteScore, createdAt] = cursor.split("|");
      params.push(Number(voteScore), createdAt);
      cursorClause = `AND (a.vote_score < $${params.length - 1} OR (a.vote_score = $${params.length - 1} AND a.created_at > $${params.length}))`;
    } else {
      params.push(cursor);
      cursorClause = `AND a.created_at < $${params.length}`;
    }
  }
  params.push(pageSize + 1);

  const { rows: topRows } = await db.query<AnswerRow>(
    `SELECT a.id, a.question_id, a.parent_answer_id, a.depth, a.body, ${AUTHOR_COLUMNS},
            a.vote_score, a.created_at, v.value AS my_vote
     FROM forum_answers a
     JOIN users u ON u.id = a.author_id
     LEFT JOIN forum_votes v ON v.target_type = 'answer' AND v.target_id = a.id AND v.user_id = $2
     WHERE a.question_id = $1 AND a.parent_answer_id IS NULL AND a.status = 'visible' AND a.deleted_at IS NULL ${cursorClause}
     ORDER BY ${orderClause}
     LIMIT $${params.length}`,
    params
  );

  const hasMore = topRows.length > pageSize;
  const topItems = hasMore ? topRows.slice(0, pageSize) : topRows;

  const { rows: qRows } = await db.query<{ best_answer_id: string | null }>(
    `SELECT best_answer_id FROM forum_questions WHERE id = $1 LIMIT 1`,
    [questionId]
  );
  const bestAnswerId = qRows[0]?.best_answer_id ?? null;

  if (topItems.length === 0) {
    return { answers: [], nextCursor: null, hasMore: false };
  }

  const topIds = topItems.map((r) => r.id);

  const { rows: replyCountRows } = await db.query<{ parent_answer_id: string; cnt: string }>(
    `SELECT parent_answer_id, COUNT(*)::text AS cnt
     FROM forum_answers
     WHERE parent_answer_id = ANY($1::uuid[]) AND status = 'visible' AND deleted_at IS NULL
     GROUP BY parent_answer_id`,
    [topIds]
  );
  const replyCounts = new Map(replyCountRows.map((r) => [r.parent_answer_id, parseInt(r.cnt, 10)]));

  const { rows: replyRows } = await db.query<AnswerRow>(
    `SELECT id, question_id, parent_answer_id, depth, body, author_id, author_username, author_display_name, author_avatar_emoji, vote_score, created_at, my_vote
     FROM (
       SELECT a.id, a.question_id, a.parent_answer_id, a.depth, a.body,
              ${AUTHOR_COLUMNS}, a.vote_score, a.created_at, v.value AS my_vote,
              ROW_NUMBER() OVER (PARTITION BY a.parent_answer_id ORDER BY a.vote_score DESC, a.created_at ASC) AS rn
       FROM forum_answers a
       JOIN users u ON u.id = a.author_id
       LEFT JOIN forum_votes v ON v.target_type = 'answer' AND v.target_id = a.id AND v.user_id = $2
       WHERE a.parent_answer_id = ANY($1::uuid[]) AND a.status = 'visible' AND a.deleted_at IS NULL
     ) ranked
     WHERE rn <= 3
     ORDER BY parent_answer_id, vote_score DESC, created_at ASC`,
    [topIds, callerId]
  );

  // BUG FIX: `replyCounts` above only covers the TOP-level answers' direct
  // (depth-1) reply counts. Without also counting each depth-1 reply's own
  // children (depth-2, i.e. "3rd level" from the question), toAnswerSummary
  // always fell back to replyCount=0 for depth-1 nodes — hiding the "view N
  // more replies" affordance entirely, so 3rd-level-and-deeper replies were
  // unreachable even though they existed in the DB (lib/forum/service.ts
  // allows arbitrary reply depth). Fetch grandchild counts for the depth-1
  // reply ids too and merge them into the same map.
  const replyIds = replyRows.map((r) => r.id);
  if (replyIds.length > 0) {
    const { rows: grandchildCountRows } = await db.query<{ parent_answer_id: string; cnt: string }>(
      `SELECT parent_answer_id, COUNT(*)::text AS cnt
       FROM forum_answers
       WHERE parent_answer_id = ANY($1::uuid[]) AND status = 'visible' AND deleted_at IS NULL
       GROUP BY parent_answer_id`,
      [replyIds]
    );
    for (const r of grandchildCountRows) replyCounts.set(r.parent_answer_id, parseInt(r.cnt, 10));
  }

  const repliesByParent = new Map<string, ForumAnswerSummary[]>();
  for (const row of replyRows) {
    const summary = toAnswerSummary(row, bestAnswerId, replyCounts);
    const list = repliesByParent.get(row.parent_answer_id!) ?? [];
    list.push(summary);
    repliesByParent.set(row.parent_answer_id!, list);
  }

  const answers = topItems.map((row) => {
    const summary = toAnswerSummary(row, bestAnswerId, replyCounts);
    summary.replies = repliesByParent.get(row.id) ?? [];
    return summary;
  });

  let nextCursor: string | null = null;
  if (hasMore) {
    const last = topItems[topItems.length - 1];
    nextCursor = sort === "best" ? `${last.vote_score}|${last.created_at}` : last.created_at;
  }

  return { answers, nextCursor, hasMore };
}

/**
 * Lazy-load a full reply subtree rooted at `answerId`, bounded by
 * MAX_ANSWER_DEPTH via a recursive CTE. Returned as a flat list with parent
 * pointers — the client reconstructs the nested tree and renders
 * "Continue this thread" for any node at the depth ceiling with further
 * (unfetched, deeper) replies.
 */
export async function getAnswerThread(callerId: string, answerId: string): Promise<ForumAnswerSummary[]> {
  const { rows: rootRows } = await db.query<{ question_id: string }>(
    `SELECT question_id FROM forum_answers WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [answerId]
  );
  if (!rootRows[0]) return [];

  const { rows: qRows } = await db.query<{ best_answer_id: string | null }>(
    `SELECT best_answer_id FROM forum_questions WHERE id = $1 LIMIT 1`,
    [rootRows[0].question_id]
  );
  const bestAnswerId = qRows[0]?.best_answer_id ?? null;

  const { rows } = await db.query<AnswerRow>(
    `WITH RECURSIVE subtree AS (
       SELECT a.*, 0 AS rel_depth FROM forum_answers a WHERE a.id = $1 AND a.deleted_at IS NULL
       UNION ALL
       SELECT a.*, s.rel_depth + 1
       FROM forum_answers a
       JOIN subtree s ON a.parent_answer_id = s.id
       WHERE a.status = 'visible' AND a.deleted_at IS NULL AND s.rel_depth < $2
     )
     SELECT subtree.id, subtree.question_id, subtree.parent_answer_id, subtree.depth, subtree.body,
            ${AUTHOR_COLUMNS}, subtree.vote_score, subtree.created_at, v.value AS my_vote
     FROM subtree
     JOIN users u ON u.id = subtree.author_id
     LEFT JOIN forum_votes v ON v.target_type = 'answer' AND v.target_id = subtree.id AND v.user_id = $3
     ORDER BY subtree.depth ASC, subtree.vote_score DESC, subtree.created_at ASC`,
    [answerId, MAX_ANSWER_DEPTH, callerId]
  );

  const replyCounts = new Map<string, number>();
  return rows.map((row) => toAnswerSummary(row, bestAnswerId, replyCounts));
}
