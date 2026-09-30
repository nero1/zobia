/**
 * lib/portals/trending.ts
 *
 * The hashtag -> portal lifecycle, run from /api/cron/feed-refresh:
 *
 *   1. promote   trending tags that pass the admin thresholds become "auto"
 *                portals (lazy: only the row is created; every section is
 *                built on the first visit, then cached);
 *   2. revive    archived auto portals that are active again;
 *   3. archive   auto portals quiet for `archiveAfterDays` (official, pinned
 *                and currently-boosted portals are never auto-archived);
 *   4. sweep     content links whose content was deleted/unpublished, then
 *                re-derive hashtags.use_count from the truth.
 *
 * Anti-spam: a tag needs BOTH a minimum number of tagged posts AND a minimum
 * number of distinct authors inside the window, so one user cannot mint a
 * portal, and blocked / merged / reserved tags never qualify. Everything is
 * set-based SQL, idempotent, and safe to run concurrently with itself.
 *
 * @module lib/portals/trending
 */

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { loadManifest } from "@/lib/manifest";
import { logger } from "@/lib/logger";
import { DEFAULT_PORTAL_SECTIONS, RESERVED_PORTAL_SLUGS } from "./constants";

export interface PortalLifecycleResult {
  promoted: number;
  revived: number;
  archived: number;
  sweptLinks: number;
  skipped?: "disabled" | "feature_off";
}

export async function runPortalLifecycle(): Promise<PortalLifecycleResult> {
  const manifest = await loadManifest();
  const orm = await getDb();
  const cfg = manifest.portals;
  const result: PortalLifecycleResult = { promoted: 0, revived: 0, archived: 0, sweptLinks: 0 };

  if (!manifest.features.portals) return { ...result, skipped: "feature_off" };

  const windowHours = Math.max(1, cfg.trendingWindowHours);
  // Expanded into individual bound params (a bare JS array would be bound as a record).
  const reserved = sql.join([...RESERVED_PORTAL_SLUGS].map((r) => sql`${r}`), sql`, `);

  if (cfg.autoCreateEnabled) {
    const promoted = await orm.execute(sql`
      WITH recent AS (
        SELECT ch.hashtag_id
        FROM content_hashtags ch
        WHERE ch.created_at > NOW() - make_interval(hours => ${windowHours})
        GROUP BY ch.hashtag_id
        HAVING COUNT(*) >= ${Math.max(1, cfg.autoMinPosts)}
           AND COUNT(DISTINCT ch.author_id) >= ${Math.max(1, cfg.autoMinDistinctUsers)}
      )
      INSERT INTO portals (slug, hashtag_id, title, status, sections, last_activity_at)
      SELECT h.slug, h.id, initcap(replace(h.slug, '_', ' ')), 'auto', ${JSON.stringify(DEFAULT_PORTAL_SECTIONS)}::jsonb, NOW()
      FROM recent r
      JOIN hashtags h ON h.id = r.hashtag_id
      WHERE h.is_blocked = false AND h.alias_of IS NULL AND h.slug NOT IN (${reserved})
      ON CONFLICT (hashtag_id) DO NOTHING
    `);
    result.promoted = promoted.rowCount ?? 0;

    const revived = await orm.execute(sql`
      UPDATE portals p SET status = 'auto', last_activity_at = NOW(), updated_at = NOW()
      WHERE p.status = 'archived'
        AND p.hashtag_id IN (
          SELECT ch.hashtag_id FROM content_hashtags ch
          WHERE ch.created_at > NOW() - make_interval(hours => ${windowHours})
          GROUP BY ch.hashtag_id
          HAVING COUNT(*) >= ${Math.max(1, cfg.autoMinPosts)}
             AND COUNT(DISTINCT ch.author_id) >= ${Math.max(1, cfg.autoMinDistinctUsers)}
        )
    `);
    result.revived = revived.rowCount ?? 0;
  }

  const archived = await orm.execute(sql`
    UPDATE portals
    SET status = 'archived', updated_at = NOW()
    WHERE status = 'auto'
      AND is_pinned = false
      AND COALESCE(last_activity_at, created_at) < NOW() - make_interval(days => ${Math.max(1, cfg.archiveAfterDays)})
      AND NOT (boost_weight > 0 AND (boost_ends_at IS NULL OR boost_ends_at > NOW()))
      AND NOT (sponsored_until IS NOT NULL AND sponsored_until > NOW())
  `);
  result.archived = archived.rowCount ?? 0;

  result.sweptLinks = await sweepStaleContentHashtags();
  logger.info(result, "[portals] lifecycle run complete");
  return result;
}

/**
 * Remove links to content that is deleted / unpublished / hidden, and any
 * link whose content row no longer exists (hard-deleted), then re-derive
 * hashtags.use_count. Bounded: one statement per content type.
 */
export async function sweepStaleContentHashtags(): Promise<number> {
  const orm = await getDb();
  const statements = [
    sql`DELETE FROM content_hashtags ch USING tweets t WHERE ch.content_type = 'tweet' AND t.id = ch.content_id AND t.deleted_at IS NOT NULL`,
    sql`DELETE FROM content_hashtags ch WHERE ch.content_type = 'tweet' AND NOT EXISTS (SELECT 1 FROM tweets t WHERE t.id = ch.content_id)`,
    sql`DELETE FROM content_hashtags ch USING blog_posts t WHERE ch.content_type = 'blog_post' AND t.id = ch.content_id AND (t.deleted_at IS NOT NULL OR t.status <> 'published')`,
    sql`DELETE FROM content_hashtags ch WHERE ch.content_type = 'blog_post' AND NOT EXISTS (SELECT 1 FROM blog_posts t WHERE t.id = ch.content_id)`,
    sql`DELETE FROM content_hashtags ch USING bb_threads t WHERE ch.content_type = 'forum_thread' AND t.id = ch.content_id AND (t.deleted_at IS NOT NULL OR t.status <> 'visible')`,
    sql`DELETE FROM content_hashtags ch WHERE ch.content_type = 'forum_thread' AND NOT EXISTS (SELECT 1 FROM bb_threads t WHERE t.id = ch.content_id)`,
    sql`DELETE FROM content_hashtags ch USING forum_questions t WHERE ch.content_type = 'forum_question' AND t.id = ch.content_id AND (t.deleted_at IS NOT NULL OR t.status <> 'visible')`,
    sql`DELETE FROM content_hashtags ch WHERE ch.content_type = 'forum_question' AND NOT EXISTS (SELECT 1 FROM forum_questions t WHERE t.id = ch.content_id)`,
    sql`DELETE FROM content_hashtags ch USING rooms t WHERE ch.content_type IN ('room', 'classroom') AND t.id = ch.content_id AND (t.deleted_at IS NOT NULL OR t.status <> 'active' OR t.is_public = false)`,
    sql`DELETE FROM content_hashtags ch WHERE ch.content_type IN ('room', 'classroom') AND NOT EXISTS (SELECT 1 FROM rooms t WHERE t.id = ch.content_id)`,
    sql`DELETE FROM content_hashtags ch USING wiki_pages t WHERE ch.content_type = 'wiki_page' AND t.id = ch.content_id AND (t.deleted_at IS NOT NULL OR t.status <> 'published')`,
    sql`DELETE FROM content_hashtags ch WHERE ch.content_type = 'wiki_page' AND NOT EXISTS (SELECT 1 FROM wiki_pages t WHERE t.id = ch.content_id)`,
    sql`DELETE FROM content_hashtags ch USING polls t WHERE ch.content_type = 'poll' AND t.id = ch.content_id AND t.deleted_at IS NOT NULL`,
    sql`DELETE FROM content_hashtags ch WHERE ch.content_type = 'poll' AND NOT EXISTS (SELECT 1 FROM polls t WHERE t.id = ch.content_id)`,
    sql`DELETE FROM content_hashtags ch USING quizzes t WHERE ch.content_type = 'quiz' AND t.id = ch.content_id AND t.deleted_at IS NOT NULL`,
    sql`DELETE FROM content_hashtags ch WHERE ch.content_type = 'quiz' AND NOT EXISTS (SELECT 1 FROM quizzes t WHERE t.id = ch.content_id)`,
    sql`DELETE FROM content_hashtags ch USING guilds t WHERE ch.content_type = 'guild' AND t.id = ch.content_id AND (t.deleted_at IS NOT NULL OR t.is_active = false)`,
    sql`DELETE FROM content_hashtags ch WHERE ch.content_type = 'guild' AND NOT EXISTS (SELECT 1 FROM guilds t WHERE t.id = ch.content_id)`,
    sql`DELETE FROM content_hashtags ch WHERE ch.content_type = 'moment' AND NOT EXISTS (SELECT 1 FROM moments t WHERE t.id = ch.content_id)`,
  ];
  let swept = 0;
  for (const stmt of statements) {
    const res = await orm.execute(stmt);
    swept += res.rowCount ?? 0;
  }

  // Re-derive counters from the truth (drift-proof, cheap: one grouped scan).
  await orm.execute(sql`
    UPDATE hashtags h SET use_count = COALESCE(c.n, 0)
    FROM hashtags h2 LEFT JOIN (SELECT hashtag_id, COUNT(*)::int AS n FROM content_hashtags GROUP BY hashtag_id) c ON c.hashtag_id = h2.id
    WHERE h2.id = h.id AND h.use_count <> COALESCE(c.n, 0)
  `);
  return swept;
}
