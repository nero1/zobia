/**
 * lib/help/service.ts
 *
 * Help Center — database-backed categories/docs, Postgres full-text search,
 * and the "Ask AI" endpoint. Markdown → HTML reuses the same
 * sanitizeBlogPostHtml pipeline as blog_posts (marked + sanitize-html).
 *
 * @module lib/help/service
 */

import { getDb, schema } from "@/lib/db/drizzle";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { loadManifest, requireFeatureEnabled } from "@/lib/manifest";
import { sanitizeBlogPostHtml } from "@/lib/security/htmlSanitizer";
import { generateUniqueSlug, recordSlugRedirect, lookupSlugRedirect } from "@/lib/slug";
import { randomUUID } from "crypto";
import { aiClient } from "@/lib/ai/client";
import { badRequest, notFound, forbidden } from "@/lib/api/errors";
import { logger } from "@/lib/logger";

export type HelpDifficulty = "first_time" | "beginner" | "intermediate" | "advanced";

export interface HelpCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
  published: boolean;
}

export interface HelpDoc {
  id: string;
  category_id: string;
  slug: string;
  title: string;
  body_markdown: string;
  body_html: string;
  difficulty: HelpDifficulty;
  sort_order: number;
  seo_title: string | null;
  seo_description: string | null;
  published: boolean;
  view_count: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Row mappers — public API shape here is snake_case (matches the pre-Drizzle
// row shape other callers already depend on); Drizzle returns camelCase.
// ---------------------------------------------------------------------------

type CategoryRow = typeof schema.helpCategories.$inferSelect;
type DocRow = typeof schema.helpDocs.$inferSelect;

function toCategory(row: CategoryRow): HelpCategory {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    sort_order: row.sortOrder,
    published: row.published,
  };
}

function toDoc(row: DocRow): HelpDoc {
  return {
    id: row.id,
    category_id: row.categoryId,
    slug: row.slug,
    title: row.title,
    body_markdown: row.bodyMarkdown,
    body_html: row.bodyHtml,
    difficulty: row.difficulty as HelpDifficulty,
    sort_order: row.sortOrder,
    seo_title: row.seoTitle,
    seo_description: row.seoDescription,
    published: row.published,
    view_count: row.viewCount,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public reads (no auth wall — Feature 2 §1)
// ---------------------------------------------------------------------------

export async function listCategories(): Promise<HelpCategory[]> {
  const orm = await getDb();
  const rows = await orm
    .select()
    .from(schema.helpCategories)
    .where(eq(schema.helpCategories.published, true))
    .orderBy(asc(schema.helpCategories.sortOrder), asc(schema.helpCategories.name));
  return rows.map(toCategory);
}

export async function listDocsByCategory(categorySlug: string): Promise<{ category: HelpCategory; docs: HelpDoc[] }> {
  const orm = await getDb();
  const [categoryRow] = await orm
    .select()
    .from(schema.helpCategories)
    .where(and(eq(schema.helpCategories.slug, categorySlug), eq(schema.helpCategories.published, true)))
    .limit(1);
  if (!categoryRow) throw notFound("Help category not found");

  const docs = await orm
    .select()
    .from(schema.helpDocs)
    .where(
      and(
        eq(schema.helpDocs.categoryId, categoryRow.id),
        eq(schema.helpDocs.published, true),
        isNull(schema.helpDocs.deletedAt)
      )
    )
    .orderBy(asc(schema.helpDocs.sortOrder), asc(schema.helpDocs.title));
  return { category: toCategory(categoryRow), docs: docs.map(toDoc) };
}

export interface DocRedirect {
  categorySlug: string;
  docSlug: string;
}

/**
 * When a direct (categorySlug, docSlug) lookup 404s, checks slug_redirects
 * for either half having been retired and returns where to 301 to.
 * Returns null when there's nothing to redirect to (a genuine 404).
 */
export async function resolveDocRedirect(categorySlug: string, docSlug: string): Promise<DocRedirect | null> {
  const [catRedirect, docRedirect] = await Promise.all([
    lookupSlugRedirect("help_category", categorySlug),
    lookupSlugRedirect("help_doc", docSlug),
  ]);
  if (!catRedirect && !docRedirect) return null;

  const orm = await getDb();

  let resolvedCategorySlug = categorySlug;
  if (catRedirect) {
    const [row] = await orm.select({ slug: schema.helpCategories.slug }).from(schema.helpCategories).where(eq(schema.helpCategories.id, catRedirect.entityId));
    if (row) resolvedCategorySlug = row.slug;
  }

  let resolvedDocSlug = docSlug;
  if (docRedirect) {
    const [row] = await orm
      .select({ slug: schema.helpDocs.slug, categoryId: schema.helpDocs.categoryId })
      .from(schema.helpDocs)
      .where(eq(schema.helpDocs.id, docRedirect.entityId));
    if (row) {
      resolvedDocSlug = row.slug;
      const [catRow] = await orm.select({ slug: schema.helpCategories.slug }).from(schema.helpCategories).where(eq(schema.helpCategories.id, row.categoryId));
      if (catRow) resolvedCategorySlug = catRow.slug;
    }
  }

  if (resolvedCategorySlug === categorySlug && resolvedDocSlug === docSlug) return null;
  return { categorySlug: resolvedCategorySlug, docSlug: resolvedDocSlug };
}

export async function getDoc(categorySlug: string, docSlug: string): Promise<{ category: HelpCategory; doc: HelpDoc }> {
  const orm = await getDb();
  const [row] = await orm
    .select({ doc: schema.helpDocs, category: schema.helpCategories })
    .from(schema.helpDocs)
    .innerJoin(schema.helpCategories, eq(schema.helpCategories.id, schema.helpDocs.categoryId))
    .where(
      and(
        eq(schema.helpCategories.slug, categorySlug),
        eq(schema.helpDocs.slug, docSlug),
        eq(schema.helpDocs.published, true),
        eq(schema.helpCategories.published, true),
        isNull(schema.helpDocs.deletedAt)
      )
    )
    .limit(1);
  if (!row) throw notFound("Help doc not found");

  // Fire-and-forget view count bump.
  orm
    .update(schema.helpDocs)
    .set({ viewCount: sql`${schema.helpDocs.viewCount} + 1` })
    .where(eq(schema.helpDocs.id, row.doc.id))
    .catch(() => {});

  return { category: toCategory(row.category), doc: toDoc(row.doc) };
}

export interface SearchResult {
  id: string;
  slug: string;
  title: string;
  category_slug: string;
  difficulty: HelpDifficulty;
  snippet: string;
}

/** Server-side full-text search over doc title/body — Postgres tsvector, no new search infra. */
export async function searchDocs(query: string, limit = 20): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const orm = await getDb();
  const capped = Math.min(limit, 50);
  const { rows } = await orm.execute<SearchResult & Record<string, unknown>>(sql`
    SELECT d.id, d.slug, d.title, c.slug AS category_slug, d.difficulty,
           ts_headline('english', d.body_markdown, plainto_tsquery('english', ${q}),
                       'MaxWords=30, MinWords=15, ShortWord=3') AS snippet
    FROM help_docs d
    JOIN help_categories c ON c.id = d.category_id
    WHERE d.published = true AND c.published = true AND d.deleted_at IS NULL
      AND (d.search_vector @@ plainto_tsquery('english', ${q}) OR d.title ILIKE ${`%${q}%`})
    ORDER BY ts_rank(d.search_vector, plainto_tsquery('english', ${q})) DESC
    LIMIT ${capped}
  `);
  return rows;
}

// ---------------------------------------------------------------------------
// Admin CRUD
// ---------------------------------------------------------------------------

export interface UpsertCategoryInput {
  slug?: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
  published?: boolean;
}

export async function createCategory(input: UpsertCategoryInput): Promise<HelpCategory> {
  const slug = input.slug?.trim() || (await generateUniqueSlug("help_category", input.name, randomUUID()));
  const orm = await getDb();
  const [row] = await orm
    .insert(schema.helpCategories)
    .values({
      slug,
      name: input.name.trim(),
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
      published: input.published ?? true,
    })
    .returning();
  return toCategory(row);
}

export async function updateCategory(id: string, input: Partial<UpsertCategoryInput>): Promise<HelpCategory> {
  const orm = await getDb();
  const [before] = await orm.select({ slug: schema.helpCategories.slug }).from(schema.helpCategories).where(eq(schema.helpCategories.id, id));
  if (!before) throw notFound("Help category not found");
  const oldSlug = before.slug;

  // Slugs are stable by default — only change when the admin explicitly
  // edits it (or it's regenerated from a new name via the CRUD UI), and we
  // always record a redirect so old links keep working (Feature 2 SEO note).
  const newSlug = input.slug?.trim() || oldSlug;

  const [row] = await orm
    .update(schema.helpCategories)
    .set({
      slug: newSlug,
      name: input.name ?? undefined,
      description: input.description ?? undefined,
      sortOrder: input.sortOrder ?? undefined,
      published: input.published ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(schema.helpCategories.id, id))
    .returning();
  if (!row) throw notFound("Help category not found");

  if (newSlug !== oldSlug) {
    await recordSlugRedirect("help_category", oldSlug, id, newSlug);
  }
  return toCategory(row);
}

/** Resolves a possibly-retired category slug to its current one (301 support). Null = not retired (or unknown). */
export async function resolveCategorySlug(slug: string): Promise<string | null> {
  const orm = await getDb();
  const [row] = await orm.select({ id: schema.helpCategories.id }).from(schema.helpCategories).where(eq(schema.helpCategories.slug, slug)).limit(1);
  if (row) return null; // already current — no redirect needed
  const redirect = await lookupSlugRedirect("help_category", slug);
  if (!redirect) return null;
  const [cur] = await orm.select({ slug: schema.helpCategories.slug }).from(schema.helpCategories).where(eq(schema.helpCategories.id, redirect.entityId));
  return cur?.slug ?? null;
}

export async function deleteCategory(id: string): Promise<void> {
  const orm = await getDb();
  await orm.delete(schema.helpCategories).where(eq(schema.helpCategories.id, id));
}

export interface UpsertDocInput {
  categoryId: string;
  slug?: string;
  title: string;
  bodyMarkdown: string;
  difficulty: HelpDifficulty;
  sortOrder?: number;
  seoTitle?: string | null;
  seoDescription?: string | null;
  published?: boolean;
  authorId: string;
}

export async function createDoc(input: UpsertDocInput): Promise<HelpDoc> {
  const bodyHtml = sanitizeBlogPostHtml(input.bodyMarkdown);
  const slug = input.slug?.trim() || (await generateUniqueSlug("help_doc", input.title, randomUUID()));

  const orm = await getDb();
  const [row] = await orm
    .insert(schema.helpDocs)
    .values({
      categoryId: input.categoryId,
      slug,
      title: input.title.trim(),
      bodyMarkdown: input.bodyMarkdown,
      bodyHtml,
      difficulty: input.difficulty,
      sortOrder: input.sortOrder ?? 0,
      seoTitle: input.seoTitle ?? null,
      seoDescription: input.seoDescription ?? null,
      published: input.published ?? false,
      authorId: input.authorId,
    })
    .returning();
  return toDoc(row);
}

export async function updateDoc(id: string, input: Partial<UpsertDocInput>): Promise<HelpDoc> {
  const orm = await getDb();
  const [before] = await orm
    .select({ slug: schema.helpDocs.slug })
    .from(schema.helpDocs)
    .where(and(eq(schema.helpDocs.id, id), isNull(schema.helpDocs.deletedAt)));
  if (!before) throw notFound("Help doc not found");
  const oldSlug = before.slug;
  // Stable by default — only changes when the admin explicitly edits the slug.
  const newSlug = input.slug?.trim() || oldSlug;

  const bodyHtml = input.bodyMarkdown !== undefined ? sanitizeBlogPostHtml(input.bodyMarkdown) : undefined;
  const [row] = await orm
    .update(schema.helpDocs)
    .set({
      categoryId: input.categoryId ?? undefined,
      slug: newSlug,
      title: input.title ?? undefined,
      bodyMarkdown: input.bodyMarkdown ?? undefined,
      bodyHtml,
      difficulty: input.difficulty ?? undefined,
      sortOrder: input.sortOrder ?? undefined,
      seoTitle: input.seoTitle ?? undefined,
      seoDescription: input.seoDescription ?? undefined,
      published: input.published ?? undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.helpDocs.id, id), isNull(schema.helpDocs.deletedAt)))
    .returning();
  if (!row) throw notFound("Help doc not found");

  if (newSlug !== oldSlug) {
    await recordSlugRedirect("help_doc", oldSlug, id, newSlug);
  }
  return toDoc(row);
}

export async function deleteDoc(id: string): Promise<void> {
  const orm = await getDb();
  await orm.update(schema.helpDocs).set({ deletedAt: new Date() }).where(eq(schema.helpDocs.id, id));
}

export async function listAllDocsForAdmin(): Promise<Array<HelpDoc & { category_slug: string; category_name: string }>> {
  const orm = await getDb();
  const rows = await orm
    .select({ doc: schema.helpDocs, categorySlug: schema.helpCategories.slug, categoryName: schema.helpCategories.name })
    .from(schema.helpDocs)
    .innerJoin(schema.helpCategories, eq(schema.helpCategories.id, schema.helpDocs.categoryId))
    .where(isNull(schema.helpDocs.deletedAt))
    .orderBy(desc(schema.helpDocs.updatedAt));
  return rows.map((r) => ({ ...toDoc(r.doc), category_slug: r.categorySlug, category_name: r.categoryName }));
}

// ---------------------------------------------------------------------------
// Ask AI
// ---------------------------------------------------------------------------

const ASK_AI_SYSTEM_PROMPT =
  "You are the Zobia Social Help Center assistant. Answer the user's question using the " +
  "provided help doc content as your primary source of truth. If the docs don't cover it, " +
  "answer from general knowledge of a gamified social platform with coins/stars/rooms, but " +
  "say you're not fully certain. Keep answers under 150 words.";

/**
 * Answers a free-text question using the current doc's content (plus a couple
 * of related docs) as context. Server-side gate: caller MUST be authenticated
 * — logged-out users never reach this (Feature 2 §6, abuse prevention).
 */
export async function askAi(question: string, docId?: string): Promise<string> {
  await requireFeatureEnabled("helpCenterAi");

  const q = question.trim();
  if (!q || q.length < 3) throw badRequest("Question must be at least 3 characters");
  if (q.length > 1000) throw badRequest("Question is too long (max 1000 characters)");

  let context = "";
  if (docId) {
    const orm = await getDb();
    const [row] = await orm
      .select({ title: schema.helpDocs.title, bodyMarkdown: schema.helpDocs.bodyMarkdown })
      .from(schema.helpDocs)
      .where(and(eq(schema.helpDocs.id, docId), eq(schema.helpDocs.published, true), isNull(schema.helpDocs.deletedAt)))
      .limit(1);
    if (row) {
      context = `Relevant Help Center doc "${row.title}":\n${row.bodyMarkdown.slice(0, 4000)}`;
    }
  }

  try {
    const response = await aiClient.chat(
      [
        { role: "system", content: ASK_AI_SYSTEM_PROMPT },
        { role: "user", content: context ? `${context}\n\nQuestion: ${q}` : q },
      ],
      { maxTokens: 400 }
    );
    return response.content.trim();
  } catch (err) {
    logger.error({ err }, "[help] askAi failed");
    throw badRequest("The AI assistant is temporarily unavailable. Please try again shortly, or contact a real person below.", "AI_UNAVAILABLE");
  }
}

export { forbidden };
