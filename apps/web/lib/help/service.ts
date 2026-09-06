/**
 * lib/help/service.ts
 *
 * Help Center — database-backed categories/docs, Postgres full-text search,
 * and the "Ask AI" endpoint. Markdown → HTML reuses the same
 * sanitizeBlogPostHtml pipeline as blog_posts (marked + sanitize-html).
 *
 * @module lib/help/service
 */

import { db } from "@/lib/db";
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
// Public reads (no auth wall — Feature 2 §1)
// ---------------------------------------------------------------------------

export async function listCategories(): Promise<HelpCategory[]> {
  const { rows } = await db.query<HelpCategory>(
    `SELECT * FROM help_categories WHERE published = true ORDER BY sort_order ASC, name ASC`
  );
  return rows;
}

export async function listDocsByCategory(categorySlug: string): Promise<{ category: HelpCategory; docs: HelpDoc[] }> {
  const { rows: catRows } = await db.query<HelpCategory>(
    `SELECT * FROM help_categories WHERE slug = $1 AND published = true LIMIT 1`,
    [categorySlug]
  );
  const category = catRows[0];
  if (!category) throw notFound("Help category not found");

  const { rows: docs } = await db.query<HelpDoc>(
    `SELECT * FROM help_docs WHERE category_id = $1 AND published = true AND deleted_at IS NULL ORDER BY sort_order ASC, title ASC`,
    [category.id]
  );
  return { category, docs };
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

  let resolvedCategorySlug = categorySlug;
  if (catRedirect) {
    const { rows } = await db.query<{ slug: string }>(`SELECT slug FROM help_categories WHERE id = $1`, [catRedirect.entityId]);
    if (rows[0]) resolvedCategorySlug = rows[0].slug;
  }

  let resolvedDocSlug = docSlug;
  if (docRedirect) {
    const { rows } = await db.query<{ slug: string; category_id: string }>(`SELECT slug, category_id FROM help_docs WHERE id = $1`, [docRedirect.entityId]);
    if (rows[0]) {
      resolvedDocSlug = rows[0].slug;
      const { rows: catRows } = await db.query<{ slug: string }>(`SELECT slug FROM help_categories WHERE id = $1`, [rows[0].category_id]);
      if (catRows[0]) resolvedCategorySlug = catRows[0].slug;
    }
  }

  if (resolvedCategorySlug === categorySlug && resolvedDocSlug === docSlug) return null;
  return { categorySlug: resolvedCategorySlug, docSlug: resolvedDocSlug };
}

export async function getDoc(categorySlug: string, docSlug: string): Promise<{ category: HelpCategory; doc: HelpDoc }> {
  const { rows } = await db.query<HelpDoc & { category_slug: string; category_name: string; category_description: string | null; category_sort_order: number; category_published: boolean; category_id2: string }>(
    `SELECT d.*, c.slug AS category_slug, c.name AS category_name, c.description AS category_description,
            c.sort_order AS category_sort_order, c.published AS category_published, c.id AS category_id2
     FROM help_docs d
     JOIN help_categories c ON c.id = d.category_id
     WHERE c.slug = $1 AND d.slug = $2 AND d.published = true AND c.published = true AND d.deleted_at IS NULL
     LIMIT 1`,
    [categorySlug, docSlug]
  );
  const row = rows[0];
  if (!row) throw notFound("Help doc not found");

  // Fire-and-forget view count bump.
  db.query(`UPDATE help_docs SET view_count = view_count + 1 WHERE id = $1`, [row.id]).catch(() => {});

  return {
    category: {
      id: row.category_id2,
      slug: row.category_slug,
      name: row.category_name,
      description: row.category_description,
      sort_order: row.category_sort_order,
      published: row.category_published,
    },
    doc: row,
  };
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

  const { rows } = await db.query<SearchResult>(
    `SELECT d.id, d.slug, d.title, c.slug AS category_slug, d.difficulty,
            ts_headline('english', d.body_markdown, plainto_tsquery('english', $1),
                        'MaxWords=30, MinWords=15, ShortWord=3') AS snippet
     FROM help_docs d
     JOIN help_categories c ON c.id = d.category_id
     WHERE d.published = true AND c.published = true AND d.deleted_at IS NULL
       AND (d.search_vector @@ plainto_tsquery('english', $1) OR d.title ILIKE $2)
     ORDER BY ts_rank(d.search_vector, plainto_tsquery('english', $1)) DESC
     LIMIT $3`,
    [q, `%${q}%`, Math.min(limit, 50)]
  );
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
  const { rows } = await db.query<HelpCategory>(
    `INSERT INTO help_categories (slug, name, description, sort_order, published)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [slug, input.name.trim(), input.description ?? null, input.sortOrder ?? 0, input.published ?? true]
  );
  return rows[0];
}

export async function updateCategory(id: string, input: Partial<UpsertCategoryInput>): Promise<HelpCategory> {
  const { rows: before } = await db.query<{ slug: string }>(`SELECT slug FROM help_categories WHERE id = $1`, [id]);
  if (!before[0]) throw notFound("Help category not found");
  const oldSlug = before[0].slug;

  // Slugs are stable by default — only change when the admin explicitly
  // edits it (or it's regenerated from a new name via the CRUD UI), and we
  // always record a redirect so old links keep working (Feature 2 SEO note).
  const newSlug = input.slug?.trim() || oldSlug;

  const { rows } = await db.query<HelpCategory>(
    `UPDATE help_categories SET
       slug = $2,
       name = COALESCE($3, name),
       description = COALESCE($4, description),
       sort_order = COALESCE($5, sort_order),
       published = COALESCE($6, published),
       updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, newSlug, input.name ?? null, input.description ?? null, input.sortOrder ?? null, input.published ?? null]
  );
  if (!rows[0]) throw notFound("Help category not found");

  if (newSlug !== oldSlug) {
    await recordSlugRedirect("help_category", oldSlug, id, newSlug);
  }
  return rows[0];
}

/** Resolves a possibly-retired category slug to its current one (301 support). Null = not retired (or unknown). */
export async function resolveCategorySlug(slug: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM help_categories WHERE slug = $1 LIMIT 1`, [slug]);
  if (rows[0]) return null; // already current — no redirect needed
  const redirect = await lookupSlugRedirect("help_category", slug);
  if (!redirect) return null;
  const { rows: cur } = await db.query<{ slug: string }>(`SELECT slug FROM help_categories WHERE id = $1`, [redirect.entityId]);
  return cur[0]?.slug ?? null;
}

export async function deleteCategory(id: string): Promise<void> {
  await db.query(`DELETE FROM help_categories WHERE id = $1`, [id]);
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

  const { rows } = await db.query<HelpDoc>(
    `INSERT INTO help_docs
       (category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published, author_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      input.categoryId,
      slug,
      input.title.trim(),
      input.bodyMarkdown,
      bodyHtml,
      input.difficulty,
      input.sortOrder ?? 0,
      input.seoTitle ?? null,
      input.seoDescription ?? null,
      input.published ?? false,
      input.authorId,
    ]
  );
  return rows[0];
}

export async function updateDoc(id: string, input: Partial<UpsertDocInput>): Promise<HelpDoc> {
  const { rows: before } = await db.query<{ slug: string }>(`SELECT slug FROM help_docs WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!before[0]) throw notFound("Help doc not found");
  const oldSlug = before[0].slug;
  // Stable by default — only changes when the admin explicitly edits the slug.
  const newSlug = input.slug?.trim() || oldSlug;

  const bodyHtml = input.bodyMarkdown !== undefined ? sanitizeBlogPostHtml(input.bodyMarkdown) : null;
  const { rows } = await db.query<HelpDoc>(
    `UPDATE help_docs SET
       category_id = COALESCE($2, category_id),
       slug = $3,
       title = COALESCE($4, title),
       body_markdown = COALESCE($5, body_markdown),
       body_html = COALESCE($6, body_html),
       difficulty = COALESCE($7, difficulty),
       sort_order = COALESCE($8, sort_order),
       seo_title = COALESCE($9, seo_title),
       seo_description = COALESCE($10, seo_description),
       published = COALESCE($11, published),
       updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [
      id,
      input.categoryId ?? null,
      newSlug,
      input.title ?? null,
      input.bodyMarkdown ?? null,
      bodyHtml,
      input.difficulty ?? null,
      input.sortOrder ?? null,
      input.seoTitle ?? null,
      input.seoDescription ?? null,
      input.published ?? null,
    ]
  );
  if (!rows[0]) throw notFound("Help doc not found");

  if (newSlug !== oldSlug) {
    await recordSlugRedirect("help_doc", oldSlug, id, newSlug);
  }
  return rows[0];
}

export async function deleteDoc(id: string): Promise<void> {
  await db.query(`UPDATE help_docs SET deleted_at = NOW() WHERE id = $1`, [id]);
}

export async function listAllDocsForAdmin(): Promise<Array<HelpDoc & { category_slug: string; category_name: string }>> {
  const { rows } = await db.query<HelpDoc & { category_slug: string; category_name: string }>(
    `SELECT d.*, c.slug AS category_slug, c.name AS category_name
     FROM help_docs d JOIN help_categories c ON c.id = d.category_id
     WHERE d.deleted_at IS NULL
     ORDER BY d.updated_at DESC`
  );
  return rows;
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
    const { rows } = await db.query<{ title: string; body_markdown: string }>(
      `SELECT title, body_markdown FROM help_docs WHERE id = $1 AND published = true AND deleted_at IS NULL LIMIT 1`,
      [docId]
    );
    if (rows[0]) {
      context = `Relevant Help Center doc "${rows[0].title}":\n${rows[0].body_markdown.slice(0, 4000)}`;
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
