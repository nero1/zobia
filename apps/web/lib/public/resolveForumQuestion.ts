/**
 * apps/web/lib/public/resolveForumQuestion.ts
 *
 * Resolves a public forum question by its URL identifier for the crawlable
 * SSR page (/a/<slug>). Mirrors lib/public/resolveRoom.ts's three-case
 * resolution so old/shared links never break:
 *
 *   1. Current slug          -> serve the question.
 *   2. Legacy /a/<uuid> link -> serve, and signal a 301 to the slug URL.
 *   3. Retired slug (rename) -> look up slug_redirects, 301 to the new slug.
 *
 * Only visible, non-deleted questions are returned; removed/needs_review
 * content resolves to null so nothing gated ever leaks to crawlers.
 */

import { db } from "@/lib/db";
import { looksLikeUuid } from "@zobia/shared/utils";
import { lookupSlugRedirect } from "@/lib/slug";

export interface PublicForumAnswer {
  id: string;
  body: string;
  vote_score: number;
  is_best_answer: boolean;
  created_at: string;
  author_username: string | null;
  author_display_name: string | null;
}

export interface PublicForumQuestion {
  id: string;
  slug: string | null;
  title: string;
  body: string;
  vote_score: number;
  answer_count: number;
  created_at: string;
  updated_at: string;
  author_username: string | null;
  author_display_name: string | null;
  category_slug: string | null;
  category_name: string | null;
  /** Up to 3 top-voted visible answers — enough for a rich SEO snippet without a full thread fetch. */
  top_answers: PublicForumAnswer[];
}

export interface ResolvedForumQuestion {
  question: PublicForumQuestion;
  /**
   * When set, the request arrived via a legacy/retired identifier and the
   * route should issue a permanent redirect to this canonical slug.
   */
  canonicalRedirectSlug: string | null;
}

const SELECT = `
  SELECT q.id, q.slug, q.title, q.body, q.vote_score, q.answer_count, q.best_answer_id,
         q.created_at, q.updated_at,
         u.username AS author_username, u.display_name AS author_display_name,
         c.slug AS category_slug, c.name AS category_name
  FROM forum_questions q
  JOIN users u ON u.id = q.author_id
  LEFT JOIN forum_categories c ON c.id = q.category_id
  WHERE q.deleted_at IS NULL AND q.status = 'visible'
`;

interface QuestionRow {
  id: string;
  slug: string | null;
  title: string;
  body: string;
  vote_score: number;
  answer_count: number;
  best_answer_id: string | null;
  created_at: string;
  updated_at: string;
  author_username: string | null;
  author_display_name: string | null;
  category_slug: string | null;
  category_name: string | null;
}

async function fetchTopAnswers(questionId: string, bestAnswerId: string | null): Promise<PublicForumAnswer[]> {
  const { rows } = await db.query<{
    id: string;
    body: string;
    vote_score: number;
    created_at: string;
    author_username: string | null;
    author_display_name: string | null;
  }>(
    `SELECT a.id, a.body, a.vote_score, a.created_at, u.username AS author_username, u.display_name AS author_display_name
     FROM forum_answers a
     JOIN users u ON u.id = a.author_id
     WHERE a.question_id = $1 AND a.status = 'visible' AND a.deleted_at IS NULL
     ORDER BY a.vote_score DESC, a.created_at ASC
     LIMIT 3`,
    [questionId]
  );
  return rows.map((r) => ({ ...r, is_best_answer: r.id === bestAnswerId }));
}

async function queryBy(column: "slug" | "id", value: string): Promise<PublicForumQuestion | null> {
  const { rows } = await db.query<QuestionRow>(`${SELECT} AND q.${column} = $1 LIMIT 1`, [value]);
  const row = rows[0];
  if (!row) return null;
  const top_answers = await fetchTopAnswers(row.id, row.best_answer_id);
  return { ...row, top_answers };
}

/**
 * Resolve a public forum question.
 *
 * @param identifier  The slug (or legacy UUID) from the URL.
 */
export async function resolvePublicForumQuestion(identifier: string): Promise<ResolvedForumQuestion | null> {
  // 1. Current slug — the common case, served as-is.
  const bySlug = await queryBy("slug", identifier);
  if (bySlug) return { question: bySlug, canonicalRedirectSlug: null };

  // 2. Legacy /a/<uuid> link — serve, but ask the caller to 301 to the slug.
  if (looksLikeUuid(identifier)) {
    const byId = await queryBy("id", identifier);
    if (byId) return { question: byId, canonicalRedirectSlug: byId.slug };
  }

  // 3. Retired slug from a rename — follow the redirect record to the question.
  const redirect = await lookupSlugRedirect("forum_question", identifier).catch(() => null);
  if (redirect) {
    const byId = await queryBy("id", redirect.entityId);
    if (byId) return { question: byId, canonicalRedirectSlug: byId.slug };
  }

  return null;
}
