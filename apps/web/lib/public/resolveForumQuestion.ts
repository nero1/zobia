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

import { getDb, schema } from "@/lib/db/drizzle";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
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
  category_id: string | null;
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

interface QuestionRow {
  id: string;
  slug: string | null;
  title: string;
  body: string;
  voteScore: number;
  answerCount: number;
  bestAnswerId: string | null;
  createdAt: Date;
  updatedAt: Date | null;
  authorUsername: string | null;
  authorDisplayName: string | null;
  categoryId: string | null;
  categorySlug: string | null;
  categoryName: string | null;
}

async function fetchTopAnswers(questionId: string, bestAnswerId: string | null): Promise<PublicForumAnswer[]> {
  const orm = await getDb();
  const rows = await orm
    .select({
      id: schema.forumAnswers.id,
      body: schema.forumAnswers.body,
      voteScore: schema.forumAnswers.voteScore,
      createdAt: schema.forumAnswers.createdAt,
      authorUsername: schema.users.username,
      authorDisplayName: schema.users.displayName,
    })
    .from(schema.forumAnswers)
    .innerJoin(schema.users, eq(schema.users.id, schema.forumAnswers.authorId))
    .where(
      and(
        eq(schema.forumAnswers.questionId, questionId),
        eq(schema.forumAnswers.status, "visible"),
        isNull(schema.forumAnswers.deletedAt)
      )
    )
    .orderBy(desc(schema.forumAnswers.voteScore), asc(schema.forumAnswers.createdAt))
    .limit(3);
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    vote_score: r.voteScore,
    is_best_answer: r.id === bestAnswerId,
    created_at: r.createdAt ? r.createdAt.toISOString() : new Date().toISOString(),
    author_username: r.authorUsername,
    author_display_name: r.authorDisplayName,
  }));
}

async function queryBy(column: "slug" | "id", value: string): Promise<PublicForumQuestion | null> {
  const orm = await getDb();
  const [row] = await orm
    .select({
      id: schema.forumQuestions.id,
      slug: schema.forumQuestions.slug,
      title: schema.forumQuestions.title,
      body: schema.forumQuestions.body,
      voteScore: schema.forumQuestions.voteScore,
      answerCount: schema.forumQuestions.answerCount,
      bestAnswerId: schema.forumQuestions.bestAnswerId,
      createdAt: schema.forumQuestions.createdAt,
      updatedAt: schema.forumQuestions.updatedAt,
      authorUsername: schema.users.username,
      authorDisplayName: schema.users.displayName,
      categoryId: schema.forumQuestions.categoryId,
      categorySlug: schema.forumCategories.slug,
      categoryName: schema.forumCategories.name,
    })
    .from(schema.forumQuestions)
    .innerJoin(schema.users, eq(schema.users.id, schema.forumQuestions.authorId))
    .leftJoin(schema.forumCategories, eq(schema.forumCategories.id, schema.forumQuestions.categoryId))
    .where(
      and(
        isNull(schema.forumQuestions.deletedAt),
        eq(schema.forumQuestions.status, "visible"),
        column === "slug" ? eq(schema.forumQuestions.slug, value) : eq(schema.forumQuestions.id, value)
      )
    )
    .limit(1);
  const r = row as QuestionRow | undefined;
  if (!r) return null;
  const top_answers = await fetchTopAnswers(r.id, r.bestAnswerId);
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    body: r.body,
    vote_score: r.voteScore,
    answer_count: r.answerCount,
    created_at: r.createdAt ? r.createdAt.toISOString() : new Date().toISOString(),
    updated_at: r.updatedAt ? r.updatedAt.toISOString() : new Date().toISOString(),
    author_username: r.authorUsername,
    author_display_name: r.authorDisplayName,
    category_id: r.categoryId,
    category_slug: r.categorySlug,
    category_name: r.categoryName,
    top_answers,
  };
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
