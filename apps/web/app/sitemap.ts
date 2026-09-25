/**
 * app/sitemap.ts
 *
 * Dynamic SEO sitemap for Zobia Social web app.
 *
 * Returns entries for:
 *   - Static public pages (landing, terms, privacy)
 *   - Public user profiles (active users, last 30 days)
 *   - Public rooms (free_open rooms, discoverable)
 *
 * Auth-gated routes (/home, /rooms, /leaderboards, /seasons, /council,
 * /moments, /quests, etc.) are intentionally excluded — they redirect
 * unauthenticated visitors to /auth/login and must not appear in a sitemap.
 *
 * Follows the Next.js MetadataRoute.Sitemap API.
 * PRD §26 Phase 7: SEO with sitemap.
 */

import type { MetadataRoute } from "next";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";

// Revalidate the sitemap at most once per hour so it doesn't run on every request.
export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";

// ---------------------------------------------------------------------------
// Static public pages (no authentication required per middleware.ts)
// ---------------------------------------------------------------------------

const STATIC_PAGES: MetadataRoute.Sitemap = [
  // Landing page — public
  { url: BASE_URL, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
  // Help / FAQ — public
  { url: `${BASE_URL}/help`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.6 },
  // Legal pages — public
  { url: `${BASE_URL}/terms`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
  { url: `${BASE_URL}/privacy`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
  // NOTE: /home, /rooms, /leaderboards, /seasons, /council, /moments, /quests
  // are all auth-gated (middleware default-deny) and must NOT appear here.
];

// ---------------------------------------------------------------------------
// Sitemap generator
// ---------------------------------------------------------------------------

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [...STATIC_PAGES];
  const db = await getDb();

  // Public user profiles — those who haven't opted out of sitemap inclusion.
  // PRIVACY-01: use sitemap_opt_out flag instead of activity recency so users
  // can permanently opt out without being silently re-included after activity.
  // Cap reduced to 2000 to keep sitemap files under the 50 MB / 50 000 URL limit.
  try {
    const profiles = await db
      .select({ username: schema.users.username, updatedAt: schema.users.updatedAt })
      .from(schema.users)
      .where(
        and(
          isNull(schema.users.deletedAt),
          eq(schema.users.sitemapOptOut, false),
          sql`${schema.users.username} IS NOT NULL`
        )
      )
      .orderBy(sql`${schema.users.lastActiveAt} DESC NULLS LAST`)
      .limit(2000);

    for (const p of profiles) {
      if (!p.username) continue;
      entries.push({
        url: `${BASE_URL}/u/${encodeURIComponent(p.username)}`,
        lastModified: p.updatedAt ?? new Date(),
        changeFrequency: "weekly",
        priority: 0.5,
      });
    }
  } catch {
    // Profiles unavailable (e.g. build-time DB not connected) — skip silently
  }

  // Public discoverable rooms (free_open only — no private rooms in sitemap).
  // Served at /r/<slug> (public, SSR, crawlable). Falls back to the UUID for
  // any legacy room not yet backfilled with a slug (still resolves + 301s).
  try {
    const rooms = await db
      .select({ id: schema.rooms.id, slug: schema.rooms.slug, updatedAt: schema.rooms.updatedAt })
      .from(schema.rooms)
      .where(and(eq(schema.rooms.type, "free_open"), isNull(schema.rooms.deletedAt), eq(schema.rooms.isActive, true)))
      .orderBy(sql`${schema.rooms.updatedAt} DESC NULLS LAST`)
      .limit(2000);

    for (const r of rooms) {
      entries.push({
        url: `${BASE_URL}/r/${encodeURIComponent(r.slug ?? r.id)}`,
        lastModified: r.updatedAt ?? new Date(),
        changeFrequency: "hourly",
        priority: 0.6,
      });
    }
  } catch {
    // Rooms unavailable — skip silently; profile entries are still returned
  }

  // Public courses (classroom rooms). Served at /c/<slug>.
  try {
    const courses = await db
      .select({ id: schema.rooms.id, slug: schema.rooms.slug, updatedAt: schema.rooms.updatedAt })
      .from(schema.rooms)
      .where(
        and(
          eq(schema.rooms.type, "classroom"),
          isNull(schema.rooms.deletedAt),
          eq(schema.rooms.isActive, true),
          eq(schema.rooms.isPublic, true)
        )
      )
      .orderBy(sql`${schema.rooms.updatedAt} DESC NULLS LAST`)
      .limit(2000);

    for (const c of courses) {
      entries.push({
        url: `${BASE_URL}/c/${encodeURIComponent(c.slug ?? c.id)}`,
        lastModified: c.updatedAt ?? new Date(),
        changeFrequency: "daily",
        priority: 0.6,
      });
    }
  } catch {
    // Courses unavailable — skip silently
  }

  // Public games. Served at /g/<slug>. The table may not exist on older DBs
  // (pre-0012 migration) — the catch keeps the sitemap working regardless.
  try {
    const gameRows = await db
      .select({ slug: schema.games.slug, updatedAt: schema.games.updatedAt })
      .from(schema.games)
      .where(and(isNull(schema.games.deletedAt), eq(schema.games.isActive, true), eq(schema.games.isPublic, true)))
      .orderBy(sql`${schema.games.updatedAt} DESC NULLS LAST`)
      .limit(2000);

    for (const g of gameRows) {
      entries.push({
        url: `${BASE_URL}/g/${encodeURIComponent(g.slug)}`,
        lastModified: g.updatedAt ?? new Date(),
        changeFrequency: "daily",
        priority: 0.5,
      });
    }
  } catch {
    // Games table absent or unavailable — skip silently
  }

  // Public forum questions (Answers). Served at /a/<slug>. Falls back
  // to the UUID for any question not yet backfilled with a slug (still
  // resolves + 301s). The table may not exist on older DBs (pre-0040
  // migration) — the catch keeps the sitemap working regardless.
  try {
    const questions = await db
      .select({ id: schema.forumQuestions.id, slug: schema.forumQuestions.slug, updatedAt: schema.forumQuestions.updatedAt })
      .from(schema.forumQuestions)
      .where(and(eq(schema.forumQuestions.status, "visible"), isNull(schema.forumQuestions.deletedAt)))
      .orderBy(sql`${schema.forumQuestions.updatedAt} DESC NULLS LAST`)
      .limit(2000);

    for (const q of questions) {
      entries.push({
        url: `${BASE_URL}/a/${encodeURIComponent(q.slug ?? q.id)}`,
        lastModified: q.updatedAt ?? new Date(),
        changeFrequency: "weekly",
        priority: 0.5,
      });
    }
  } catch {
    // Forum questions unavailable — skip silently
  }

  // Public blogs. Served at /b/<slug>. The table may not exist on older DBs
  // (pre-0002-blogs migration) — the catch keeps the sitemap working regardless.
  try {
    const blogRows = await db
      .select({ slug: schema.blogs.slug, updatedAt: schema.blogs.updatedAt })
      .from(schema.blogs)
      .where(and(isNull(schema.blogs.deletedAt), eq(schema.blogs.status, "active")))
      .orderBy(sql`${schema.blogs.updatedAt} DESC NULLS LAST`)
      .limit(2000);

    for (const b of blogRows) {
      entries.push({
        url: `${BASE_URL}/b/${encodeURIComponent(b.slug)}`,
        lastModified: b.updatedAt ?? new Date(),
        changeFrequency: "daily",
        priority: 0.5,
      });
    }
  } catch {
    // Blogs table absent or unavailable — skip silently
  }

  // Public wikis. Served at /w/<slug>, viewable while 'active' or 'paused'
  // (mirrors resolvePublicWiki's status check). Their published pages are
  // also enumerated at /w/<slug>/<pageSlug>, capped per-wiki so a single
  // huge wiki can't blow up the sitemap size, and capped overall alongside
  // every other entity type here. The wikis table may not exist on older
  // DBs — the catch keeps the sitemap working regardless.
  try {
    const wikiRows = await db
      .select({ id: schema.wikis.id, slug: schema.wikis.slug, updatedAt: schema.wikis.updatedAt })
      .from(schema.wikis)
      .where(and(isNull(schema.wikis.deletedAt), sql`${schema.wikis.status} IN ('active', 'paused')`))
      .orderBy(sql`${schema.wikis.updatedAt} DESC NULLS LAST`)
      .limit(2000);

    for (const w of wikiRows) {
      entries.push({
        url: `${BASE_URL}/w/${encodeURIComponent(w.slug)}`,
        lastModified: w.updatedAt ?? new Date(),
        changeFrequency: "weekly",
        priority: 0.5,
      });
    }

    // Published pages for those same wikis, capped at 20 per wiki to keep
    // the overall URL count in check while still surfacing a wiki's most
    // recently-updated content to crawlers.
    if (wikiRows.length > 0) {
      const wikiPageResult = await db.execute(sql`
        SELECT * FROM (
           SELECT w.slug AS wiki_slug, p.slug, p.updated_at,
                  ROW_NUMBER() OVER (PARTITION BY p.wiki_id ORDER BY p.updated_at DESC NULLS LAST) AS rn
           FROM wiki_pages p
           JOIN wikis w ON w.id = p.wiki_id
           WHERE p.deleted_at IS NULL AND p.status = 'published'
             AND w.deleted_at IS NULL AND w.status IN ('active', 'paused')
         ) ranked
         WHERE rn <= 20
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 2000
      `);
      const wikiPageRows = wikiPageResult.rows as unknown as Array<{ wiki_slug: string; slug: string; updated_at: string | null }>;

      for (const p of wikiPageRows) {
        entries.push({
          url: `${BASE_URL}/w/${encodeURIComponent(p.wiki_slug)}/${encodeURIComponent(p.slug)}`,
          lastModified: p.updated_at ? new Date(p.updated_at) : new Date(),
          changeFrequency: "monthly",
          priority: 0.45,
        });
      }
    }
  } catch {
    // Wikis tables absent or unavailable — skip silently
  }

  // Public Tweets. Served at /t/<id> — Tweets have no slug, just the uuid.
  // The table may not exist on older DBs (pre-0039-tweets migration) — the
  // catch keeps the sitemap working regardless.
  try {
    const tweetRows = await db
      .select({ id: schema.tweets.id, createdAt: schema.tweets.createdAt })
      .from(schema.tweets)
      .where(isNull(schema.tweets.deletedAt))
      .orderBy(desc(schema.tweets.createdAt))
      .limit(2000);

    for (const tw of tweetRows) {
      entries.push({
        url: `${BASE_URL}/t/${encodeURIComponent(tw.id)}`,
        lastModified: tw.createdAt ?? new Date(),
        changeFrequency: "daily",
        priority: 0.4,
      });
    }
  } catch {
    // Tweets table absent or unavailable — skip silently
  }

  // Public polls. Served at /poll/<slug>. The table may not exist on older
  // DBs (pre-0038 migration) — the catch keeps the sitemap working regardless.
  try {
    const pollRows = await db
      .select({ slug: schema.polls.slug, updatedAt: schema.polls.updatedAt })
      .from(schema.polls)
      .where(and(isNull(schema.polls.deletedAt), eq(schema.polls.status, "active")))
      .orderBy(sql`${schema.polls.updatedAt} DESC NULLS LAST`)
      .limit(2000);
    for (const p of pollRows) {
      entries.push({ url: `${BASE_URL}/poll/${encodeURIComponent(p.slug)}`, lastModified: p.updatedAt ?? new Date(), changeFrequency: "daily", priority: 0.4 });
    }
  } catch {
    // Polls table absent or unavailable — skip silently
  }

  // Public quizzes. Served at /quiz/<slug>.
  try {
    const quizRows = await db
      .select({ slug: schema.quizzes.slug, updatedAt: schema.quizzes.updatedAt })
      .from(schema.quizzes)
      .where(and(isNull(schema.quizzes.deletedAt), eq(schema.quizzes.status, "active")))
      .orderBy(sql`${schema.quizzes.updatedAt} DESC NULLS LAST`)
      .limit(2000);
    for (const q of quizRows) {
      entries.push({ url: `${BASE_URL}/quiz/${encodeURIComponent(q.slug)}`, lastModified: q.updatedAt ?? new Date(), changeFrequency: "daily", priority: 0.4 });
    }
  } catch {
    // Quizzes table absent or unavailable — skip silently
  }

  // Public Business Pages. Served at /p/<slug>. The table may not exist on
  // older DBs (pre-0003-business-expansion migration) — skip silently.
  try {
    const pageRows = await db
      .select({ slug: schema.businessPages.slug, updatedAt: schema.businessPages.updatedAt })
      .from(schema.businessPages)
      .innerJoin(schema.businessAccounts, eq(schema.businessAccounts.id, schema.businessPages.businessAccountId))
      .where(
        and(
          isNull(schema.businessPages.deletedAt),
          eq(schema.businessPages.status, "active"),
          eq(schema.businessAccounts.status, "active")
        )
      )
      .orderBy(sql`${schema.businessPages.updatedAt} DESC NULLS LAST`)
      .limit(2000);

    for (const p of pageRows) {
      entries.push({
        url: `${BASE_URL}/p/${encodeURIComponent(p.slug)}`,
        lastModified: p.updatedAt ?? new Date(),
        changeFrequency: "weekly",
        priority: 0.4,
      });
    }
  } catch {
    // Business pages table absent or unavailable — skip silently
  }

  // BB-style forum boards + threads. Boards at /forum/<slug>, threads at
  // the short canonical /f/<slug>. The tables may not exist on older DBs
  // (pre-0016-bbforum migration) — skip silently.
  try {
    const boardRows = await db
      .select({ slug: schema.bbBoards.slug, updatedAt: schema.bbBoards.updatedAt })
      .from(schema.bbBoards)
      .where(eq(schema.bbBoards.isActive, true))
      .orderBy(schema.bbBoards.sortOrder)
      .limit(500);
    entries.push({ url: `${BASE_URL}/forum`, lastModified: new Date(), changeFrequency: "daily", priority: 0.6 });
    for (const b of boardRows) {
      entries.push({
        url: `${BASE_URL}/forum/${encodeURIComponent(b.slug)}`,
        lastModified: b.updatedAt ?? new Date(),
        changeFrequency: "daily",
        priority: 0.5,
      });
    }

    const threadRows = await db
      .select({ slug: schema.bbThreads.slug, updatedAt: schema.bbThreads.updatedAt })
      .from(schema.bbThreads)
      .where(and(isNull(schema.bbThreads.deletedAt), eq(schema.bbThreads.status, "visible")))
      .orderBy(sql`${schema.bbThreads.updatedAt} DESC NULLS LAST`)
      .limit(2000);
    for (const t of threadRows) {
      entries.push({
        url: `${BASE_URL}/f/${encodeURIComponent(t.slug)}`,
        lastModified: t.updatedAt ?? new Date(),
        changeFrequency: "weekly",
        priority: 0.5,
      });
    }
  } catch {
    // BB forum tables absent or unavailable — skip silently
  }

  // Help Center categories + docs. Served at /help/<category>[/<doc>]. The
  // tables may not exist on older DBs (pre-0009 migration) — skip silently.
  try {
    const helpCategoryRows = await db
      .select({ slug: schema.helpCategories.slug, updatedAt: schema.helpCategories.updatedAt })
      .from(schema.helpCategories)
      .where(eq(schema.helpCategories.published, true))
      .orderBy(sql`${schema.helpCategories.updatedAt} DESC NULLS LAST`)
      .limit(500);
    for (const c of helpCategoryRows) {
      entries.push({ url: `${BASE_URL}/help/${encodeURIComponent(c.slug)}`, lastModified: c.updatedAt ?? new Date(), changeFrequency: "weekly", priority: 0.5 });
    }

    const helpDocRows = await db
      .select({
        categorySlug: schema.helpCategories.slug,
        docSlug: schema.helpDocs.slug,
        updatedAt: schema.helpDocs.updatedAt,
      })
      .from(schema.helpDocs)
      .innerJoin(schema.helpCategories, eq(schema.helpCategories.id, schema.helpDocs.categoryId))
      .where(
        and(
          eq(schema.helpDocs.published, true),
          eq(schema.helpCategories.published, true),
          isNull(schema.helpDocs.deletedAt)
        )
      )
      .orderBy(sql`${schema.helpDocs.updatedAt} DESC NULLS LAST`)
      .limit(2000);
    for (const d of helpDocRows) {
      entries.push({
        url: `${BASE_URL}/help/${encodeURIComponent(d.categorySlug)}/${encodeURIComponent(d.docSlug)}`,
        lastModified: d.updatedAt ?? new Date(),
        changeFrequency: "monthly",
        priority: 0.55,
      });
    }
  } catch {
    // Help Center tables absent or unavailable — skip silently
  }

  return entries;
}
