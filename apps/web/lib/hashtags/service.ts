/**
 * lib/hashtags/service.ts
 *
 * Hashtag storage pipeline. Every content write path (tweets, moments, blogs,
 * forum, rooms, ...) calls `syncContentHashtags` with the text fields that may
 * contain `#tags`; it upserts the tag vocabulary, follows admin merges
 * (hashtags.alias_of), skips blocked tags and replaces the content's link rows
 * in `content_hashtags`.
 *
 * Parsing/normalising is the shared, pure implementation in
 * @zobia/shared/utils (web, PWA and Capacitor render `#tag` identically).
 *
 * Design notes:
 *  - Two bulk statements per sync (tag upsert + link diff), never per-tag loops.
 *  - `syncContentHashtags` accepts a transaction handle so creators can keep
 *    tag rows atomic with the content insert; `recordContentHashtags` is the
 *    best-effort wrapper for callers that must never fail a post over tagging.
 *  - No Redis here. Portal/feed caches expire on their own TTL.
 *
 * @module lib/hashtags/service
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { logger } from "@/lib/logger";
import { extractHashtagsFrom, HASHTAG_MAX_PER_CONTENT } from "@zobia/shared/utils";

export type HashtagContentType =
  | "moment"
  | "tweet"
  | "blog_post"
  | "forum_thread"
  | "forum_question"
  | "room"
  | "classroom"
  | "wiki_page"
  | "game"
  | "poll"
  | "quiz"
  | "guild"
  | "business_page_post";

export interface SyncContentHashtagsInput {
  contentType: HashtagContentType;
  contentId: string;
  authorId: string | null;
  /** Every text field of the content that may contain #tags (title, body, caption, ...). */
  texts: (string | null | undefined)[];
}

export interface SyncContentHashtagsResult {
  /** Canonical (alias-resolved) slugs now linked to the content. */
  slugs: string[];
}

/**
 * Replace the hashtag links of one piece of content with the tags found in
 * `texts`. Idempotent: calling it again with the same text is a no-op, calling
 * it with edited text adds/removes the difference. Blocked tags are dropped.
 *
 * FAILURE-SAFE: the work runs in its own (nested) transaction, i.e. a
 * SAVEPOINT when `db` is already a transaction handle, so ANY error inside
 * (a constraint violation, a deadlock with another tagger) rolls back only the
 * tagging and is logged, and the caller's surrounding transaction (the post,
 * the charge) carries on untouched. Without the savepoint one failed tagging
 * statement would poison the caller's whole transaction and lose the post.
 */
export async function syncContentHashtags(db: DbOrTx, input: SyncContentHashtagsInput): Promise<SyncContentHashtagsResult> {
  try {
    return await db.transaction(async (sp) => doSyncContentHashtags(sp, input));
  } catch (err) {
    logger.error({ err, contentType: input.contentType, contentId: input.contentId }, "[hashtags] failed to sync content hashtags (non-fatal, rolled back to savepoint)");
    return { slugs: [] };
  }
}

async function doSyncContentHashtags(db: DbOrTx, input: SyncContentHashtagsInput): Promise<SyncContentHashtagsResult> {
  // Sorted so concurrent taggers lock hashtag rows in the same order (no deadlocks).
  const parsed = extractHashtagsFrom(...input.texts).slice(0, HASHTAG_MAX_PER_CONTENT).sort();

  let targetIds: string[] = [];
  let targetSlugs: string[] = [];

  if (parsed.length > 0) {
    // 1. Upsert the vocabulary in one statement. `display` keeps the first
    //    spelling seen; on conflict only the activity stamp moves.
    await db
      .insert(schema.hashtags)
      .values(parsed.map((slug) => ({ slug, display: slug })))
      .onConflictDoUpdate({ target: schema.hashtags.slug, set: { lastUsedAt: sql`NOW()` } });

    const rows = await db
      .select({
        id: schema.hashtags.id,
        slug: schema.hashtags.slug,
        aliasOf: schema.hashtags.aliasOf,
        isBlocked: schema.hashtags.isBlocked,
      })
      .from(schema.hashtags)
      .where(inArray(schema.hashtags.slug, parsed));

    // 2. Follow admin merges (one hop: merges always point at the survivor).
    const aliasIds = [...new Set(rows.map((r) => r.aliasOf).filter((x): x is string => !!x))];
    const survivors = aliasIds.length
      ? await db
          .select({ id: schema.hashtags.id, slug: schema.hashtags.slug, isBlocked: schema.hashtags.isBlocked })
          .from(schema.hashtags)
          .where(inArray(schema.hashtags.id, aliasIds))
      : [];
    const survivorById = new Map(survivors.map((s) => [s.id, s]));

    const resolved = new Map<string, string>(); // id -> slug
    for (const r of rows) {
      if (r.aliasOf) {
        const s = survivorById.get(r.aliasOf);
        if (s && !s.isBlocked && !r.isBlocked) resolved.set(s.id, s.slug);
      } else if (!r.isBlocked) {
        resolved.set(r.id, r.slug);
      }
    }
    targetIds = [...resolved.keys()];
    targetSlugs = [...resolved.values()];
  }

  // 3. Diff against the existing links.
  const existing = await db
    .select({ hashtagId: schema.contentHashtags.hashtagId })
    .from(schema.contentHashtags)
    .where(and(eq(schema.contentHashtags.contentType, input.contentType), eq(schema.contentHashtags.contentId, input.contentId)));
  const existingIds = new Set(existing.map((e) => e.hashtagId));
  const target = new Set(targetIds);

  const toRemove = [...existingIds].filter((id) => !target.has(id));
  const toAdd = targetIds.filter((id) => !existingIds.has(id));

  if (toRemove.length > 0) {
    await db
      .delete(schema.contentHashtags)
      .where(
        and(
          eq(schema.contentHashtags.contentType, input.contentType),
          eq(schema.contentHashtags.contentId, input.contentId),
          inArray(schema.contentHashtags.hashtagId, toRemove)
        )
      );
    await db
      .update(schema.hashtags)
      .set({ useCount: sql`GREATEST(${schema.hashtags.useCount} - 1, 0)` })
      .where(inArray(schema.hashtags.id, toRemove));
  }

  if (toAdd.length > 0) {
    const inserted = await db
      .insert(schema.contentHashtags)
      .values(toAdd.map((hashtagId) => ({ hashtagId, contentType: input.contentType, contentId: input.contentId, authorId: input.authorId })))
      .onConflictDoNothing()
      .returning({ hashtagId: schema.contentHashtags.hashtagId });
    const insertedIds = inserted.map((i) => i.hashtagId);
    if (insertedIds.length > 0) {
      await db
        .update(schema.hashtags)
        .set({ useCount: sql`${schema.hashtags.useCount} + 1`, lastUsedAt: sql`NOW()` })
        .where(inArray(schema.hashtags.id, insertedIds));
      // Keep portal freshness (drives auto-archive) without a cron scan.
      await db
        .update(schema.portals)
        .set({ lastActivityAt: sql`NOW()` })
        .where(inArray(schema.portals.hashtagId, insertedIds));
    }
  }

  return { slugs: targetSlugs };
}

/**
 * Convenience wrapper for callers outside a transaction (the content insert
 * has already committed): resolves the default DB handle and never throws.
 * (`syncContentHashtags` is itself failure-safe; this only also guards
 * `getDb()`.)
 */
export async function recordContentHashtags(input: SyncContentHashtagsInput, db?: DbOrTx): Promise<string[]> {
  try {
    const orm = db ?? (await getDb());
    const { slugs } = await syncContentHashtags(orm, input);
    return slugs;
  } catch (err) {
    logger.error({ err, contentType: input.contentType, contentId: input.contentId }, "[hashtags] failed to record content hashtags (non-fatal)");
    return [];
  }
}

/** Remove every hashtag link for deleted content so tag counts/velocity stay honest. */
export async function removeContentHashtags(contentType: HashtagContentType, contentId: string, db?: DbOrTx): Promise<void> {
  await recordContentHashtags({ contentType, contentId, authorId: null, texts: [] }, db);
}

/** Canonical hashtag row for a slug, following one alias hop. Null when unknown or blocked. */
export async function resolveHashtag(slug: string): Promise<{ id: string; slug: string; display: string; useCount: number } | null> {
  const orm = await getDb();
  const [row] = await orm
    .select({
      id: schema.hashtags.id,
      slug: schema.hashtags.slug,
      display: schema.hashtags.display,
      useCount: schema.hashtags.useCount,
      aliasOf: schema.hashtags.aliasOf,
      isBlocked: schema.hashtags.isBlocked,
    })
    .from(schema.hashtags)
    .where(eq(schema.hashtags.slug, slug))
    .limit(1);
  if (!row || row.isBlocked) return null;
  if (!row.aliasOf) return { id: row.id, slug: row.slug, display: row.display, useCount: row.useCount };
  const [target] = await orm
    .select({ id: schema.hashtags.id, slug: schema.hashtags.slug, display: schema.hashtags.display, useCount: schema.hashtags.useCount, isBlocked: schema.hashtags.isBlocked })
    .from(schema.hashtags)
    .where(and(eq(schema.hashtags.id, row.aliasOf), isNull(schema.hashtags.aliasOf)))
    .limit(1);
  if (!target || target.isBlocked) return null;
  return { id: target.id, slug: target.slug, display: target.display, useCount: target.useCount };
}

export interface HashtagSuggestion {
  slug: string;
  display: string;
  useCount: number;
  hasPortal: boolean;
}

/**
 * Prefix/trigram tag search for composers ("#la" -> lagos, lasu) and the
 * search page. Canonical (non-alias), non-blocked tags only; ordered by
 * prefix match first, then popularity.
 */
export async function searchHashtags(query: string, limit = 10): Promise<HashtagSuggestion[]> {
  const q = query.trim().replace(/^#/, "").toLowerCase();
  const orm = await getDb();
  const capped = Math.max(1, Math.min(limit, 25));
  const { rows } = await orm.execute<{ slug: string; display: string; use_count: number; has_portal: boolean } & Record<string, unknown>>(sql`
    SELECT h.slug, h.display, h.use_count,
           EXISTS (SELECT 1 FROM portals p WHERE p.hashtag_id = h.id AND p.status IN ('official', 'auto')) AS has_portal
    FROM hashtags h
    WHERE h.is_blocked = false AND h.alias_of IS NULL
      AND (${q} = '' OR h.slug LIKE ${q.replace(/[\\%_]/g, (c) => `\\${c}`) + "%"} OR h.slug % ${q})
    ORDER BY (h.slug LIKE ${q.replace(/[\\%_]/g, (c) => `\\${c}`) + "%"}) DESC, h.use_count DESC, h.slug
    LIMIT ${capped}
  `);
  return rows.map((r) => ({ slug: r.slug, display: r.display, useCount: Number(r.use_count), hasPortal: !!r.has_portal }));
}
